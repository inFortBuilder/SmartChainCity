// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
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
/// MVP: sem proxy e sem leilão com prazo. O UUPS atrás de timelock e o leilão entram antes da mainnet (doc 07 §5).
contract Marketplace is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
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

    IERC20 public immutable currency;
    address public treasury;
    uint16 public feeBps;
    uint256 public nextListingId = 1;

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

    constructor(address admin, IERC20 currency_, address treasury_, uint16 feeBps_) {
        if (admin == address(0) || address(currency_) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
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

    // ------------------------------------------------------------------ leitura

    function itemsOf(uint256 listingId) external view returns (Item[] memory) {
        return _items[listingId];
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
}
