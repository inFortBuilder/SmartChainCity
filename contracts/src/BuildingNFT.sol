// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title BuildingNFT
/// @notice Prédio de construtor sobre um lote (doc 13 §7, E2.11). O world assina um voucher (EIP-712) quando o
/// prédio passou na validação do lote e no alvará. O contrato guarda o lote, o hash do GLB aprovado, os andares e o
/// construtor. Trocar o modelo exige nova validação, novo hash e um novo token.
/// Regras on-chain: só o construtor do voucher minta, e ele precisa ser o dono do lote no `LandNFT` (não existe
/// prédio sobre lote de terceiro). Um prédio vigente por lote; demolir (`burn`) libera o lote para outro.
contract BuildingNFT is ERC721, EIP712, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "BuildingVoucher(uint256 lotId,address developer,bytes32 modelHash,uint16 floors,uint256 nonce,uint256 deadline)"
    );

    struct BuildingVoucher {
        uint256 lotId;
        address developer;
        bytes32 modelHash;
        uint16 floors;
        uint256 nonce;
        uint256 deadline;
    }

    struct Building {
        uint256 lotId;
        bytes32 modelHash;
        uint16 floors;
        address developer;
    }

    IERC721 public immutable land;
    uint256 public nextId = 1;
    string private baseTokenURI;

    mapping(uint256 tokenId => Building) private buildings;
    /// @notice Prédio vigente de cada lote (0 se não houver).
    mapping(uint256 lotId => uint256 tokenId) public buildingOfLot;
    mapping(uint256 nonce => bool) public nonceUsed;

    event BuildingMinted(
        uint256 indexed tokenId,
        uint256 indexed lotId,
        address indexed developer,
        bytes32 modelHash,
        uint16 floors
    );
    event BuildingDemolished(uint256 indexed tokenId, uint256 indexed lotId);
    event BaseURIChanged(string baseURI);

    error VoucherExpired();
    error NonceAlreadyUsed();
    error InvalidSigner(address recovered);
    error NotVoucherDeveloper();
    error NotLotOwner();
    error LotHasBuilding(uint256 tokenId);
    error EmptyModel();
    error NotBuildingAndLotOwner();
    error ZeroAddress();

    constructor(address admin, IERC721 land_, string memory baseURI_)
        ERC721("Smart Chain City Building", "SCCBLDG")
        EIP712("SCC BuildingNFT", "1")
    {
        if (admin == address(0) || address(land_) == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        land = land_;
        baseTokenURI = baseURI_;
    }

    /// @notice Hash EIP-712 que o world assina.
    function voucherDigest(BuildingVoucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(VOUCHER_TYPEHASH, v.lotId, v.developer, v.modelHash, v.floors, v.nonce, v.deadline)
            )
        );
    }

    function mint(BuildingVoucher calldata v, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (msg.sender != v.developer) revert NotVoucherDeveloper();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > v.deadline) revert VoucherExpired();
        if (nonceUsed[v.nonce]) revert NonceAlreadyUsed();
        if (v.modelHash == bytes32(0)) revert EmptyModel();
        address signer = ECDSA.recover(voucherDigest(v), signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert InvalidSigner(signer);
        // Lote sem NFT reverte no ownerOf: o lote precisa estar on-chain e ser do construtor.
        if (land.ownerOf(v.lotId) != v.developer) revert NotLotOwner();
        uint256 current = buildingOfLot[v.lotId];
        if (current != 0) revert LotHasBuilding(current);

        nonceUsed[v.nonce] = true;
        tokenId = nextId++;
        buildings[tokenId] = Building(v.lotId, v.modelHash, v.floors, v.developer);
        buildingOfLot[v.lotId] = tokenId;
        // _mint, e não _safeMint: o construtor é quem chamou, e um callback aqui só abriria reentrada.
        // forge-lint: disable-next-line(unsafe-oz-erc721-mint)
        _mint(v.developer, tokenId);
        // A única chamada externa antes é o ownerOf do LandNFT (contrato do projeto, só leitura).
        // forge-lint: disable-next-line(reentrancy-events)
        emit BuildingMinted(tokenId, v.lotId, v.developer, v.modelHash, v.floors);
    }

    /// @notice Demolição: quem tem o prédio e o lote libera o lote para outro prédio.
    function demolish(uint256 tokenId) external nonReentrant {
        Building memory b = buildings[tokenId];
        if (ownerOf(tokenId) != msg.sender || land.ownerOf(b.lotId) != msg.sender) {
            revert NotBuildingAndLotOwner();
        }
        delete buildingOfLot[b.lotId];
        delete buildings[tokenId];
        _burn(tokenId);
        emit BuildingDemolished(tokenId, b.lotId);
    }

    function buildingOf(uint256 tokenId) external view returns (Building memory) {
        _requireOwned(tokenId);
        return buildings[tokenId];
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
