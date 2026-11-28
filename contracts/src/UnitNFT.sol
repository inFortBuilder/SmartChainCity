// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title UnitNFT
/// @notice Uma unidade de prédio de construtor por token (doc 13 §7, E3.11): apartamento, sala ou loja. Guarda o
/// prédio (`BuildingNFT`), o andar, a área e o código da unidade. Nasce na 1ª venda, pelo `UnitMarket`
/// (MINTER_ROLE), a partir do voucher do world, e uma unidade do prédio só vira token uma vez.
/// Royalty EIP-2981 para o construtor (2% por padrão) em cada revenda: o `Marketplace` já paga o royalty que o
/// token declara. Transferências pausam junto com o contrato (incidente).
contract UnitNFT is ERC721, ERC2981, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice Teto do royalty do construtor: 10%.
    uint96 public constant MAX_ROYALTY_BPS = 1000;

    struct Unit {
        uint256 buildingId;
        /// @dev Id da unidade no world (hash do uuid): uma unidade do prédio, um token.
        uint256 unitKey;
        uint16 floor;
        /// @dev Área em centímetros quadrados de m² (m² × 100), para áreas como 72,35 m².
        uint32 areaM2x100;
        bytes16 code;
    }

    uint256 public nextId = 1;
    uint96 public royaltyBps = 200;
    string private baseTokenURI;

    mapping(uint256 tokenId => Unit) private units;
    /// @notice Token de cada unidade do prédio (0 se ainda não foi vendida on-chain).
    mapping(uint256 buildingId => mapping(uint256 unitKey => uint256 tokenId)) public tokenOfUnit;

    event UnitMinted(
        uint256 indexed tokenId,
        uint256 indexed buildingId,
        uint256 indexed unitKey,
        address to,
        address developer,
        uint16 floor,
        uint32 areaM2x100,
        bytes16 code
    );
    event RoyaltyChanged(uint96 bps);
    event BaseURIChanged(string baseURI);

    error ZeroAddress();
    error UnitAlreadyMinted(uint256 tokenId);
    error RoyaltyTooHigh();

    constructor(address admin, string memory baseURI_) ERC721("Smart Chain City Unit", "SCCUNIT") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        baseTokenURI = baseURI_;
    }

    /// @notice Cria o token da unidade para o comprador, com o royalty para o construtor. Só o `UnitMarket`.
    function mint(address to, address developer, Unit calldata u)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (to == address(0) || developer == address(0)) revert ZeroAddress();
        uint256 existing = tokenOfUnit[u.buildingId][u.unitKey];
        if (existing != 0) revert UnitAlreadyMinted(existing);
        tokenId = nextId++;
        units[tokenId] = u;
        tokenOfUnit[u.buildingId][u.unitKey] = tokenId;
        _setTokenRoyalty(tokenId, developer, royaltyBps);
        // _mint, e não _safeMint: o comprador é quem chamou o UnitMarket; sem callback, sem reentrada.
        // forge-lint: disable-next-line(unsafe-oz-erc721-mint)
        _mint(to, tokenId);
        emit UnitMinted(tokenId, u.buildingId, u.unitKey, to, developer, u.floor, u.areaM2x100, u.code);
    }

    function unitOf(uint256 tokenId) external view returns (Unit memory) {
        _requireOwned(tokenId);
        return units[tokenId];
    }

    /// @notice Royalty das próximas unidades (as já criadas mantêm o delas).
    function setRoyaltyBps(uint96 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        royaltyBps = bps;
        emit RoyaltyChanged(bps);
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

    /// @dev Transferência (e mint) parada com o contrato pausado.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        whenNotPaused
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
