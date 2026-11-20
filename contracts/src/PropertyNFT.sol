// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title PropertyNFT
/// @notice Imóvel do catálogo (Casa T1 e os próximos) sobre um lote âncora (doc 07 §2.2, E2.5). O world assina um
/// voucher (EIP-712) quando a obra terminou. O contrato guarda o lote âncora, o tipo e o nível. Desgaste e renda
/// ficam off-chain, no world.
/// Regras on-chain:
/// - O id do token é o id do imóvel no world (os 128 bits do UUID): o mesmo imóvel não vira dois tokens, e o
///   world sabe o id sem esperar o indexador.
/// - Só o dono do voucher minta, e ele precisa ser o dono do lote no `LandNFT` na hora do mint. Um imóvel por lote.
/// - Depois do mint, o imóvel circula livre (ERC-721). No jogo, ele só rende se o dono do imóvel for dono do lote
///   (doc 07 §2.2); a venda em combo fica com o `Marketplace`.
/// - `upgrade` só sobe o nível, com voucher do world; o mesmo voucher não serve duas vezes porque o nível só sobe.
contract PropertyNFT is ERC721, EIP712, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "PropertyVoucher(uint256 tokenId,address owner,uint256 lotId,bytes32 typeCode,uint16 level,uint256 deadline)"
    );
    bytes32 public constant LEVEL_TYPEHASH =
        keccak256("LevelVoucher(uint256 tokenId,uint16 level,uint256 deadline)");

    struct PropertyVoucher {
        uint256 tokenId;
        address owner;
        uint256 lotId;
        /// @dev Código do tipo no catálogo (`t1`), em bytes32 com zeros à direita.
        bytes32 typeCode;
        uint16 level;
        uint256 deadline;
    }

    struct LevelVoucher {
        uint256 tokenId;
        uint16 level;
        uint256 deadline;
    }

    struct Property {
        uint256 lotId;
        bytes32 typeCode;
        uint16 level;
    }

    IERC721 public immutable land;
    string private baseTokenURI;

    mapping(uint256 tokenId => Property) private properties;
    /// @notice Imóvel de cada lote (0 se não houver).
    mapping(uint256 lotId => uint256 tokenId) public propertyOfLot;

    event PropertyMinted(
        uint256 indexed tokenId, uint256 indexed lotId, address indexed owner, bytes32 typeCode, uint16 level
    );
    event PropertyUpgraded(uint256 indexed tokenId, uint16 level);
    event BaseURIChanged(string baseURI);

    error VoucherExpired();
    error InvalidSigner(address recovered);
    error NotVoucherOwner();
    error NotLotOwner();
    error LotHasProperty(uint256 tokenId);
    error InvalidVoucher();
    error NotPropertyOwner();
    error LevelNotHigher(uint16 current);
    error ZeroAddress();

    constructor(address admin, IERC721 land_, string memory baseURI_)
        ERC721("Smart Chain City Property", "SCCPROP")
        EIP712("SCC PropertyNFT", "1")
    {
        if (admin == address(0) || address(land_) == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        land = land_;
        baseTokenURI = baseURI_;
    }

    /// @notice Hash EIP-712 do voucher de mint que o world assina.
    function voucherDigest(PropertyVoucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(VOUCHER_TYPEHASH, v.tokenId, v.owner, v.lotId, v.typeCode, v.level, v.deadline)
            )
        );
    }

    /// @notice Hash EIP-712 do voucher de nível que o world assina.
    function levelDigest(LevelVoucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(LEVEL_TYPEHASH, v.tokenId, v.level, v.deadline)));
    }

    function mint(PropertyVoucher calldata v, bytes calldata signature) external nonReentrant whenNotPaused {
        if (msg.sender != v.owner) revert NotVoucherOwner();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > v.deadline) revert VoucherExpired();
        if (v.tokenId == 0 || v.level == 0 || v.typeCode == bytes32(0)) revert InvalidVoucher();
        _checkSigner(voucherDigest(v), signature);
        // Lote sem NFT reverte no ownerOf: o lote precisa estar on-chain e ser do dono do imóvel.
        if (land.ownerOf(v.lotId) != v.owner) revert NotLotOwner();
        uint256 current = propertyOfLot[v.lotId];
        if (current != 0) revert LotHasProperty(current);

        properties[v.tokenId] = Property(v.lotId, v.typeCode, v.level);
        propertyOfLot[v.lotId] = v.tokenId;
        // _mint reverte se o token já existe: o mesmo voucher não minta duas vezes.
        // _mint, e não _safeMint: o dono é quem chamou, e um callback aqui só abriria reentrada.
        // forge-lint: disable-next-line(unsafe-oz-erc721-mint)
        _mint(v.owner, v.tokenId);
        // A única chamada externa antes é o ownerOf do LandNFT (contrato do projeto, só leitura).
        // forge-lint: disable-next-line(reentrancy-events)
        emit PropertyMinted(v.tokenId, v.lotId, v.owner, v.typeCode, v.level);
    }

    /// @notice Leva ao contrato o nível que o imóvel ganhou na obra do world. Só o dono do imóvel chama.
    function upgrade(LevelVoucher calldata v, bytes calldata signature) external nonReentrant whenNotPaused {
        if (ownerOf(v.tokenId) != msg.sender) revert NotPropertyOwner();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > v.deadline) revert VoucherExpired();
        uint16 current = properties[v.tokenId].level;
        if (v.level <= current) revert LevelNotHigher(current);
        _checkSigner(levelDigest(v), signature);
        properties[v.tokenId].level = v.level;
        // A "chamada externa" do lint é o ecrecover (precompile, só leitura).
        // forge-lint: disable-next-line(reentrancy-events)
        emit PropertyUpgraded(v.tokenId, v.level);
    }

    function propertyOf(uint256 tokenId) external view returns (Property memory) {
        _requireOwned(tokenId);
        return properties[tokenId];
    }

    function setBaseURI(string calldata baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseTokenURI = baseURI_;
        emit BaseURIChanged(baseURI_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _checkSigner(bytes32 digest, bytes calldata signature) private view {
        address signer = ECDSA.recover(digest, signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert InvalidSigner(signer);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
