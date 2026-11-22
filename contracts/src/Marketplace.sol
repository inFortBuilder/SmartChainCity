// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {
    AccessControlUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
// Sem estado próprio (ERC-7201, `@custom:stateless` na OZ 5.7): serve no proxy sem inicializar.
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Marketplace
/// @notice Mercado secundário dos NFTs do jogo (doc 07 §2.5, E3.6), com preço fixo em SCITY.
/// - O vendedor lista um ou mais NFTs de coleções permitidas por um preço só. Mais de um é o combo (lote + imóvel),
///   que passa inteiro na mesma transação. Os NFTs ficam na carteira do vendedor até a venda: ele só aprova o
///   contrato (`setApprovalForAll`).
/// - Na compra, saem do preço a taxa do protocolo (para a tesouraria) e os royalties EIP-2981 de cada NFT que os
///   declara; o resto vai para o vendedor. Se o vendedor já não tem algum NFT (vendeu fora, apreensão do leilão),
///   a compra reverte.
/// - A regra de bairro fica só no jogo (ADR-0014): o contrato não restringe quem compra.
/// - Leilão com prazo: os NFTs ficam guardados aqui até o fim; lances em SCITY também (o anterior volta na hora),
///   5% acima do maior, e um lance nos últimos 10 minutos estica o prazo. No fim, qualquer um fecha.
/// Upgrade (doc 07 §5): proxy UUPS (ERC-1967). Só o UPGRADER_ROLE troca a implementação, e esse papel fica com o
/// TimelockController (48 h na mainnet, com o multisig propondo). A implementação nasce travada
/// (`_disableInitializers`); o estado mora no proxy. As bases da OpenZeppelin usam armazenamento com namespace
/// (ERC-7201); as variáveis deste contrato só podem ganhar novas no fim, nunca mudar de ordem.
contract Marketplace is AccessControlUpgradeable, PausableUpgradeable, ReentrancyGuard, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint16 public constant MAX_FEE_BPS = 1000; // 10%
    uint256 public constant MAX_ITEMS = 5;

    struct Item {
        address collection;
        uint256 tokenId;
    }

    struct Listing {
        address seller;
        uint64 expiresAt;
        bool active;
        uint256 price;
    }

    IERC20 public currency;
    address public treasury;
    uint16 public feeBps;
    /// @dev Começa em 1 (0 é "sem listagem"), no `initialize`: no proxy, valor na declaração não vale.
    uint256 public nextListingId;

    mapping(address collection => bool) public allowedCollection;
    mapping(uint256 listingId => Listing) public listings;
    mapping(uint256 listingId => Item[]) internal _items;
    /// @notice Listagem ativa de cada NFT (uma por vez).
    mapping(address collection => mapping(uint256 tokenId => uint256 listingId)) public listingOf;

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        uint256 price,
        uint64 expiresAt,
        address[] collections,
        uint256[] tokenIds
    );
    event Sold(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 fee,
        uint256 royalty
    );
    event Cancelled(uint256 indexed listingId);
    event FeeChanged(address treasury, uint16 feeBps);
    event CollectionAllowed(address indexed collection, bool allowed);

    error ZeroAddress();
    error FeeTooHigh();
    error BadItems();
    error CollectionNotAllowed(address collection);
    error NotOwner(address collection, uint256 tokenId);
    error NotApproved(address collection, uint256 tokenId);
    error AlreadyListed(uint256 listingId);
    error ZeroPrice();
    error BadExpiry();
    error NotActive();
    error Expired();
    error PriceChanged(uint256 price);
    error ListingStale(address collection, uint256 tokenId);
    error NotSeller();
    error SelfPurchase();

    // ------------------------------------------------------------------ leilão (estado)

    /// @notice Lance mínimo acima do atual: 5%.
    uint16 public constant MIN_BID_INCREMENT_BPS = 500;
    /// @notice Lance nos últimos 10 minutos empurra o fim para 10 minutos depois dele (contra o lance de última hora).
    uint64 public constant EXTENSION = 10 minutes;
    uint64 public constant MIN_DURATION = 1 hours;
    uint64 public constant MAX_DURATION = 14 days;

    struct Auction {
        address seller;
        uint64 endsAt;
        bool active;
        address highestBidder;
        uint256 startPrice;
        uint256 highestBid;
    }

    /// @dev Começa em 1, no `initialize` (como `nextListingId`).
    uint256 public nextAuctionId;
    mapping(uint256 auctionId => Auction) public auctions;
    mapping(uint256 auctionId => Item[]) internal _auctionItems;

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        uint256 startPrice,
        uint64 endsAt,
        address[] collections,
        uint256[] tokenIds
    );
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount, uint64 endsAt);
    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed seller,
        address indexed winner,
        uint256 price,
        uint256 fee,
        uint256 royalty
    );
    event AuctionCancelled(uint256 indexed auctionId);

    error BadDuration();
    error AuctionEnded();
    error AuctionNotEnded();
    error BidTooLow(uint256 minimum);
    error HasBids();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Inicializa o proxy. `admin` fica com DEFAULT_ADMIN e PAUSER; `upgrader` (o timelock) troca a implementação.
    function initialize(address admin, address upgrader, IERC20 currency_, address treasury_, uint16 feeBps_)
        external
        initializer
    {
        if (
            admin == address(0) || upgrader == address(0) || address(currency_) == address(0)
                || treasury_ == address(0)
        ) {
            revert ZeroAddress();
        }
        __AccessControl_init();
        __Pausable_init();
        nextListingId = 1;
        nextAuctionId = 1;
        _grantRole(UPGRADER_ROLE, upgrader);
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        currency = currency_;
        treasury = treasury_;
        feeBps = feeBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        emit FeeChanged(treasury_, feeBps_);
    }

    // ------------------------------------------------------------------ vender

    /// @notice Lista os NFTs por `price` SCITY até `expiresAt`. Um NFT com listagem viva de outro dono (que vendeu
    /// fora do mercado) pode ser listado de novo pelo dono atual.
    function list(Item[] calldata items, uint256 price, uint64 expiresAt)
        external
        whenNotPaused
        returns (uint256 listingId)
    {
        if (items.length == 0 || items.length > MAX_ITEMS) revert BadItems();
        if (price == 0) revert ZeroPrice();
        if (expiresAt <= block.timestamp) revert BadExpiry();
        listingId = nextListingId++;
        address[] memory collections = new address[](items.length);
        uint256[] memory tokenIds = new uint256[](items.length);
        for (uint256 i; i < items.length; ++i) {
            Item calldata it = items[i];
            if (!allowedCollection[it.collection]) revert CollectionNotAllowed(it.collection);
            for (uint256 j; j < i; ++j) {
                if (items[j].collection == it.collection && items[j].tokenId == it.tokenId) {
                    revert BadItems();
                }
            }
            IERC721 nft = IERC721(it.collection);
            if (nft.ownerOf(it.tokenId) != msg.sender) revert NotOwner(it.collection, it.tokenId);
            if (
                !nft.isApprovedForAll(msg.sender, address(this))
                    && nft.getApproved(it.tokenId) != address(this)
            ) {
                revert NotApproved(it.collection, it.tokenId);
            }
            uint256 previous = listingOf[it.collection][it.tokenId];
            if (previous != 0 && _live(previous) && listings[previous].seller == msg.sender) {
                revert AlreadyListed(previous);
            }
            if (previous != 0 && listings[previous].active) _close(previous);
            listingOf[it.collection][it.tokenId] = listingId;
            _items[listingId].push(it);
            collections[i] = it.collection;
            tokenIds[i] = it.tokenId;
        }
        listings[listingId] = Listing({seller: msg.sender, expiresAt: expiresAt, active: true, price: price});
        emit Listed(listingId, msg.sender, price, expiresAt, collections, tokenIds);
    }

    /// @notice O vendedor tira a listagem; o admin também (moderação).
    function cancel(uint256 listingId) external {
        Listing storage l = listings[listingId];
        if (!l.active) revert NotActive();
        if (msg.sender != l.seller && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotSeller();
        _close(listingId);
        emit Cancelled(listingId);
    }

    // ------------------------------------------------------------------ comprar

    /// @notice Compra a listagem. `maxPrice` protege contra troca de preço (o vendedor relista mais caro) entre
    /// a tela e a transação. O comprador aprova antes o SCITY para este contrato.
    function buy(uint256 listingId, uint256 maxPrice) external nonReentrant whenNotPaused {
        Listing memory l = listings[listingId];
        if (!l.active) revert NotActive();
        if (block.timestamp >= l.expiresAt) revert Expired();
        if (l.price > maxPrice) revert PriceChanged(l.price);
        if (msg.sender == l.seller) revert SelfPurchase();
        Item[] memory items = _items[listingId];

        // Efeitos antes das chamadas externas.
        _close(listingId);

        uint256 fee = (l.price * feeBps) / 10_000;
        uint256 share = l.price / items.length;
        uint256 royalty = 0;
        // Só leituras primeiro: posse e royalties. O evento sai antes de qualquer transferência.
        address[] memory receivers = new address[](items.length);
        uint256[] memory amounts = new uint256[](items.length);
        for (uint256 i; i < items.length; ++i) {
            IERC721 nft = IERC721(items[i].collection);
            if (nft.ownerOf(items[i].tokenId) != l.seller) {
                revert ListingStale(items[i].collection, items[i].tokenId);
            }
            (receivers[i], amounts[i]) = _royalty(items[i], share);
            if (receivers[i] == address(0)) amounts[i] = 0;
            royalty += amounts[i];
        }
        if (fee + royalty > l.price) revert FeeTooHigh();
        emit Sold(listingId, l.seller, msg.sender, l.price, fee, royalty);

        for (uint256 i; i < items.length; ++i) {
            if (amounts[i] > 0) currency.safeTransferFrom(msg.sender, receivers[i], amounts[i]);
        }
        if (fee > 0) currency.safeTransferFrom(msg.sender, treasury, fee);
        currency.safeTransferFrom(msg.sender, l.seller, l.price - fee - royalty);
        for (uint256 i; i < items.length; ++i) {
            IERC721(items[i].collection).safeTransferFrom(l.seller, msg.sender, items[i].tokenId);
        }
    }

    // ------------------------------------------------------------------ leilão

    /// @notice Leiloa os NFTs: eles ficam guardados neste contrato até o fim (o vendedor não os move no meio).
    /// O primeiro lance é de pelo menos `startPrice`; o leilão dura `duration` segundos, de 1 h a 14 dias.
    function createAuction(Item[] calldata items, uint256 startPrice, uint64 duration)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 auctionId)
    {
        if (items.length == 0 || items.length > MAX_ITEMS) revert BadItems();
        if (startPrice == 0) revert ZeroPrice();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert BadDuration();
        auctionId = nextAuctionId++;
        uint64 endsAt = uint64(block.timestamp) + duration;
        address[] memory collections = new address[](items.length);
        uint256[] memory tokenIds = new uint256[](items.length);
        for (uint256 i; i < items.length; ++i) {
            Item calldata it = items[i];
            if (!allowedCollection[it.collection]) revert CollectionNotAllowed(it.collection);
            for (uint256 j; j < i; ++j) {
                if (items[j].collection == it.collection && items[j].tokenId == it.tokenId) {
                    revert BadItems();
                }
            }
            IERC721 nft = IERC721(it.collection);
            if (nft.ownerOf(it.tokenId) != msg.sender) revert NotOwner(it.collection, it.tokenId);
            if (
                !nft.isApprovedForAll(msg.sender, address(this))
                    && nft.getApproved(it.tokenId) != address(this)
            ) {
                revert NotApproved(it.collection, it.tokenId);
            }
            // A venda a preço fixo do mesmo NFT acaba: ele vai para o leilão.
            uint256 previous = listingOf[it.collection][it.tokenId];
            if (previous != 0 && listings[previous].active) {
                _close(previous);
                emit Cancelled(previous);
            }
            _auctionItems[auctionId].push(it);
            collections[i] = it.collection;
            tokenIds[i] = it.tokenId;
        }
        auctions[auctionId] = Auction({
            seller: msg.sender,
            endsAt: endsAt,
            active: true,
            highestBidder: address(0),
            startPrice: startPrice,
            highestBid: 0
        });
        emit AuctionCreated(auctionId, msg.sender, startPrice, endsAt, collections, tokenIds);
        for (uint256 i; i < items.length; ++i) {
            IERC721(items[i].collection).transferFrom(msg.sender, address(this), items[i].tokenId);
        }
    }

    /// @notice O lance mínimo agora: o preço inicial ou 5% acima do maior lance.
    function minimumBid(uint256 auctionId) public view returns (uint256) {
        Auction storage a = auctions[auctionId];
        if (a.highestBid == 0) return a.startPrice;
        uint256 step = (a.highestBid * MIN_BID_INCREMENT_BPS) / 10_000;
        return a.highestBid + (step == 0 ? 1 : step);
    }

    /// @notice Dá um lance: o SCITY fica guardado aqui e o lance anterior volta na hora para quem o deu.
    function bid(uint256 auctionId, uint256 amount) external nonReentrant whenNotPaused {
        Auction storage a = auctions[auctionId];
        if (!a.active) revert NotActive();
        if (block.timestamp >= a.endsAt) revert AuctionEnded();
        if (msg.sender == a.seller) revert SelfPurchase();
        uint256 minimum = minimumBid(auctionId);
        if (amount < minimum) revert BidTooLow(minimum);
        address previousBidder = a.highestBidder;
        uint256 previousBid = a.highestBid;
        a.highestBidder = msg.sender;
        a.highestBid = amount;
        if (a.endsAt - block.timestamp < EXTENSION) a.endsAt = uint64(block.timestamp) + EXTENSION;
        emit BidPlaced(auctionId, msg.sender, amount, a.endsAt);
        currency.safeTransferFrom(msg.sender, address(this), amount);
        if (previousBidder != address(0)) currency.safeTransfer(previousBidder, previousBid);
    }

    /// @notice Fecha o leilão vencido (qualquer um chama). Com lance, paga taxa, royalties e vendedor e entrega os
    /// NFTs ao vencedor; sem lance, devolve os NFTs ao vendedor. Se algum NFT saiu daqui (apreensão do leilão por
    /// imposto, ADR-0016), o leilão é desfeito: o lance volta e o que restou volta ao vendedor.
    function settle(uint256 auctionId) external nonReentrant whenNotPaused {
        Auction memory a = auctions[auctionId];
        if (!a.active) revert NotActive();
        if (block.timestamp < a.endsAt) revert AuctionNotEnded();
        auctions[auctionId].active = false;
        Item[] memory items = _auctionItems[auctionId];
        if (a.highestBidder == address(0) || !_holdsAll(items)) {
            if (a.highestBidder == address(0)) emit AuctionSettled(auctionId, a.seller, address(0), 0, 0, 0);
            else emit AuctionCancelled(auctionId);
            _unwind(a, items);
            return;
        }
        uint256 fee = (a.highestBid * feeBps) / 10_000;
        (address[] memory receivers, uint256[] memory amounts, uint256 royalty) =
            _royalties(items, a.highestBid);
        if (fee + royalty > a.highestBid) revert FeeTooHigh();
        emit AuctionSettled(auctionId, a.seller, a.highestBidder, a.highestBid, fee, royalty);
        for (uint256 i; i < items.length; ++i) {
            if (amounts[i] > 0) currency.safeTransfer(receivers[i], amounts[i]);
        }
        if (fee > 0) currency.safeTransfer(treasury, fee);
        currency.safeTransfer(a.seller, a.highestBid - fee - royalty);
        for (uint256 i; i < items.length; ++i) {
            IERC721(items[i].collection).safeTransferFrom(address(this), a.highestBidder, items[i].tokenId);
        }
    }

    /// @notice O vendedor cancela enquanto não há lance; o admin cancela sempre (moderação), devolvendo o lance.
    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction memory a = auctions[auctionId];
        if (!a.active) revert NotActive();
        bool admin = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
        if (msg.sender != a.seller && !admin) revert NotSeller();
        if (a.highestBidder != address(0) && !admin) revert HasBids();
        auctions[auctionId].active = false;
        emit AuctionCancelled(auctionId);
        _unwind(a, _auctionItems[auctionId]);
    }

    // ------------------------------------------------------------------ leitura

    function itemsOf(uint256 listingId) external view returns (Item[] memory) {
        return _items[listingId];
    }

    function auctionItemsOf(uint256 auctionId) external view returns (Item[] memory) {
        return _auctionItems[auctionId];
    }

    // ------------------------------------------------------------------ admin

    function setFee(address treasury_, uint16 feeBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        treasury = treasury_;
        feeBps = feeBps_;
        emit FeeChanged(treasury_, feeBps_);
    }

    function setCollection(address collection, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (collection == address(0)) revert ZeroAddress();
        allowedCollection[collection] = allowed;
        emit CollectionAllowed(collection, allowed);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------------ interno

    function _live(uint256 listingId) internal view returns (bool) {
        Listing storage l = listings[listingId];
        return l.active && block.timestamp < l.expiresAt;
    }

    function _close(uint256 listingId) internal {
        listings[listingId].active = false;
        Item[] storage items = _items[listingId];
        for (uint256 i; i < items.length; ++i) {
            if (listingOf[items[i].collection][items[i].tokenId] == listingId) {
                delete listingOf[items[i].collection][items[i].tokenId];
            }
        }
    }

    /// @dev Royalties de cada NFT sobre a parte dele no preço.
    function _royalties(Item[] memory items, uint256 price)
        internal
        view
        returns (address[] memory receivers, uint256[] memory amounts, uint256 total)
    {
        receivers = new address[](items.length);
        amounts = new uint256[](items.length);
        uint256 share = price / items.length;
        for (uint256 i; i < items.length; ++i) {
            (receivers[i], amounts[i]) = _royalty(items[i], share);
            if (receivers[i] == address(0)) amounts[i] = 0;
            total += amounts[i];
        }
    }

    /// @dev Todos os NFTs do leilão ainda estão guardados aqui?
    function _holdsAll(Item[] memory items) internal view returns (bool) {
        for (uint256 i; i < items.length; ++i) {
            if (IERC721(items[i].collection).ownerOf(items[i].tokenId) != address(this)) return false;
        }
        return true;
    }

    /// @dev Desfaz o leilão: o lance volta para quem o deu e os NFTs que ainda estão aqui voltam ao vendedor.
    function _unwind(Auction memory a, Item[] memory items) internal {
        if (a.highestBidder != address(0)) currency.safeTransfer(a.highestBidder, a.highestBid);
        for (uint256 i; i < items.length; ++i) {
            IERC721 nft = IERC721(items[i].collection);
            if (nft.ownerOf(items[i].tokenId) == address(this)) {
                nft.safeTransferFrom(address(this), a.seller, items[i].tokenId);
            }
        }
    }

    /// @dev Royalty EIP-2981 da coleção, se ela declarar; coleções sem o padrão não pagam royalty.
    function _royalty(Item memory it, uint256 price) internal view returns (address, uint256) {
        try IERC165(it.collection).supportsInterface(type(IERC2981).interfaceId) returns (bool ok) {
            if (!ok) return (address(0), 0);
        } catch {
            return (address(0), 0);
        }
        try IERC2981(it.collection).royaltyInfo(it.tokenId, price) returns (
            address receiver, uint256 amount
        ) {
            return (receiver, amount);
        } catch {
            return (address(0), 0);
        }
    }

    /// @dev Só o timelock (UPGRADER_ROLE) troca a implementação.
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
