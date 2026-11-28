// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {UnitNFT} from "./UnitNFT.sol";

/// @title UnitMarket
/// @notice Venda primária e aluguel das unidades dos prédios de construtor (doc 13 §7, E3.11), em SCITY.
/// - **Venda primária:** o world assina o voucher (EIP-712) da unidade para um comprador, com o preço. O contrato
///   confere que o construtor do voucher ainda é o dono do prédio no `BuildingNFT`, cobra o comprador (taxa da
///   plataforma para a tesouraria, o resto para o construtor) e cria o token no `UnitNFT`, com o royalty para o
///   construtor. Cada unidade só vira token uma vez; cada voucher só vale uma vez.
/// - **Revenda:** pelo `Marketplace`, que já paga o royalty EIP-2981 do token (2% ao construtor).
/// - **Aluguel por período:** o dono põe o preço por dia; quem aluga paga os dias (taxa da Prefeitura para a
///   tesouraria, o resto para o dono). Um inquilino por vez; o mesmo inquilino estende, até 30 dias adiantados.
///   A oferta vale só para o dono que a fez: vendida a unidade, some. O aluguel pago segue até o fim, mesmo com a
///   venda (como no jogo).
/// O dinheiro não fica no contrato: vai direto do comprador para a tesouraria e para o construtor ou o dono.
/// PREMISSAS: taxas de 5% na venda primária e de 10% no aluguel (as do jogo); até 30 dias de aluguel adiantados.
contract UnitMarket is EIP712, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint16 public constant MAX_FEE_BPS = 1000; // 10%
    uint64 public constant MAX_RENT_AHEAD = 30 days;

    bytes32 public constant SALE_TYPEHASH = keccak256(
        "UnitSale(uint256 buildingId,uint256 unitKey,uint16 floor,uint32 areaM2x100,bytes16 code,address buyer,address developer,uint256 price,uint256 nonce,uint256 deadline)"
    );

    struct UnitSale {
        uint256 buildingId;
        uint256 unitKey;
        uint16 floor;
        uint32 areaM2x100;
        bytes16 code;
        address buyer;
        address developer;
        uint256 price;
        uint256 nonce;
        uint256 deadline;
    }

    struct RentOffer {
        address owner;
        uint256 pricePerDay;
    }

    struct Lease {
        address tenant;
        uint64 endsAt;
    }

    UnitNFT public immutable units;
    IERC721 public immutable buildings;
    IERC20 public immutable currency;
    address public treasury;
    uint16 public primaryFeeBps;
    uint16 public rentFeeBps;

    mapping(uint256 nonce => bool) public nonceUsed;
    mapping(uint256 tokenId => RentOffer) private offers;
    mapping(uint256 tokenId => Lease) public leases;

    event PrimarySold(
        uint256 indexed tokenId,
        uint256 indexed buildingId,
        address indexed buyer,
        address developer,
        uint256 price,
        uint256 fee
    );
    event RentOffered(uint256 indexed tokenId, address indexed owner, uint256 pricePerDay);
    event Rented(
        uint256 indexed tokenId,
        address indexed tenant,
        address indexed owner,
        uint64 endsAt,
        uint256 paid,
        uint256 fee
    );
    event FeesChanged(address treasury, uint16 primaryFeeBps, uint16 rentFeeBps);

    error ZeroAddress();
    error FeeTooHigh();
    error VoucherExpired();
    error NonceAlreadyUsed();
    error InvalidSigner(address recovered);
    error NotVoucherBuyer();
    error NotBuildingOwner();
    error NotUnitOwner();
    error NotForRent();
    error PriceChanged(uint256 pricePerDay);
    error OwnUnit();
    error UnitRented(address tenant, uint64 endsAt);
    error BadDays();
    error RentPrepaid();

    constructor(
        address admin,
        UnitNFT units_,
        IERC721 buildings_,
        IERC20 currency_,
        address treasury_,
        uint16 primaryFeeBps_,
        uint16 rentFeeBps_
    ) EIP712("SCC UnitMarket", "1") {
        if (
            admin == address(0) || address(units_) == address(0) || address(buildings_) == address(0)
                || address(currency_) == address(0) || treasury_ == address(0)
        ) revert ZeroAddress();
        if (primaryFeeBps_ > MAX_FEE_BPS || rentFeeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        units = units_;
        buildings = buildings_;
        currency = currency_;
        treasury = treasury_;
        primaryFeeBps = primaryFeeBps_;
        rentFeeBps = rentFeeBps_;
    }

    // ------------------------------------------------------------------ venda primária

    /// @notice Hash EIP-712 que o world assina.
    function saleDigest(UnitSale calldata s) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SALE_TYPEHASH,
                    s.buildingId,
                    s.unitKey,
                    s.floor,
                    s.areaM2x100,
                    s.code,
                    s.buyer,
                    s.developer,
                    s.price,
                    s.nonce,
                    s.deadline
                )
            )
        );
    }

    /// @notice O comprador do voucher paga e recebe o token da unidade. Precisa aprovar o `price` em SCITY antes.
    function buyPrimary(UnitSale calldata s, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (msg.sender != s.buyer) revert NotVoucherBuyer();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > s.deadline) revert VoucherExpired();
        if (nonceUsed[s.nonce]) revert NonceAlreadyUsed();
        address signer = ECDSA.recover(saleDigest(s), signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert InvalidSigner(signer);
        // O prédio tem que existir e ser do construtor do voucher (vendido o prédio, o voucher antigo não vale).
        if (buildings.ownerOf(s.buildingId) != s.developer) revert NotBuildingOwner();

        nonceUsed[s.nonce] = true;
        uint256 fee = (s.price * primaryFeeBps) / 10_000;
        tokenId = units.mint(
            s.buyer,
            s.developer,
            UnitNFT.Unit({
                buildingId: s.buildingId,
                unitKey: s.unitKey,
                floor: s.floor,
                areaM2x100: s.areaM2x100,
                code: s.code
            })
        );
        // msg.sender == s.buyer (conferido no começo).
        if (fee > 0) currency.safeTransferFrom(msg.sender, treasury, fee);
        if (s.price > fee) currency.safeTransferFrom(msg.sender, s.developer, s.price - fee);
        // As chamadas externas são ao UnitNFT e ao SCITY (contratos do projeto), com nonReentrant.
        // forge-lint: disable-next-line(reentrancy-events)
        emit PrimarySold(tokenId, s.buildingId, s.buyer, s.developer, s.price, fee);
    }

    // ------------------------------------------------------------------ aluguel

    /// @notice O dono põe (ou tira, com 0) o preço por dia. Vale enquanto ele for o dono.
    function setRent(uint256 tokenId, uint256 pricePerDay) external whenNotPaused {
        if (units.ownerOf(tokenId) != msg.sender) revert NotUnitOwner();
        offers[tokenId] = RentOffer(msg.sender, pricePerDay);
        emit RentOffered(tokenId, msg.sender, pricePerDay);
    }

    /// @notice Preço por dia em vigor (0 sem oferta, ou se a unidade mudou de dono).
    function rentPrice(uint256 tokenId) public view returns (uint256) {
        RentOffer memory o = offers[tokenId];
        return o.owner != address(0) && o.owner == units.ownerOf(tokenId) ? o.pricePerDay : 0;
    }

    /// @notice Aluga por `daysCount` dias (1 a 30). O mesmo inquilino estende; outro espera o fim.
    /// `maxPricePerDay` protege contra o dono trocar o preço antes da transação entrar.
    function rent(uint256 tokenId, uint16 daysCount, uint256 maxPricePerDay)
        external
        nonReentrant
        whenNotPaused
    {
        address owner = units.ownerOf(tokenId);
        uint256 price = rentPrice(tokenId);
        if (price == 0) revert NotForRent();
        if (price > maxPricePerDay) revert PriceChanged(price);
        if (msg.sender == owner) revert OwnUnit();
        if (daysCount == 0 || daysCount > 30) revert BadDays();
        Lease memory l = leases[tokenId];
        // forge-lint: disable-next-line(block-timestamp)
        bool active = l.endsAt > block.timestamp;
        if (active && l.tenant != msg.sender) revert UnitRented(l.tenant, l.endsAt);
        // block.timestamp cabe em uint64 por bilhões de anos.
        // forge-lint: disable-next-line(block-timestamp, unsafe-typecast)
        uint64 base = active ? l.endsAt : uint64(block.timestamp);
        uint64 endsAt = base + uint64(daysCount) * 1 days;
        // forge-lint: disable-next-line(block-timestamp)
        if (endsAt - block.timestamp > MAX_RENT_AHEAD) revert RentPrepaid();

        leases[tokenId] = Lease(msg.sender, endsAt);
        uint256 total = price * daysCount;
        uint256 fee = (total * rentFeeBps) / 10_000;
        if (fee > 0) currency.safeTransferFrom(msg.sender, treasury, fee);
        if (total > fee) currency.safeTransferFrom(msg.sender, owner, total - fee);
        emit Rented(tokenId, msg.sender, owner, endsAt, total, fee);
    }

    /// @notice Quem mora na unidade agora (address(0) se ninguém).
    function tenantOf(uint256 tokenId) external view returns (address) {
        Lease memory l = leases[tokenId];
        // forge-lint: disable-next-line(block-timestamp)
        return l.endsAt > block.timestamp ? l.tenant : address(0);
    }

    // ------------------------------------------------------------------ administração

    function setFees(address treasury_, uint16 primaryFeeBps_, uint16 rentFeeBps_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (primaryFeeBps_ > MAX_FEE_BPS || rentFeeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        treasury = treasury_;
        primaryFeeBps = primaryFeeBps_;
        rentFeeBps = rentFeeBps_;
        emit FeesChanged(treasury_, primaryFeeBps_, rentFeeBps_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
