// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {Payment} from "./lib/Payment.sol";

/// @title LandNFT
/// @notice Lotes da cidade (doc 07 §2.1, ADR-0012). O lote é um polígono identificado no serviço world por
/// (cidade, número do lote); o `tokenId` junta os dois em 64 bits e pode ser desfeito.
/// A venda primária só acontece com uma cotação assinada pelo world (EIP-712), que já conferiu bairro
/// aberto, regra de bairro e teto de área. O contrato confere assinatura, comprador, preço, prazo e nonce.
/// Com `price == 0` o lote já foi pago no ledger do jogo e o contrato só registra a posse on-chain.
/// A transferência secundária é livre (ADR-0014): a regra de bairro vale só dentro do jogo.
contract LandNFT is ERC721, EIP712, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "LotQuote(uint32 city,uint32 lot,address buyer,address currency,uint256 price,uint256 nonce,uint256 deadline)"
    );

    struct LotQuote {
        uint32 city;
        uint32 lot;
        address buyer;
        address currency;
        uint256 price;
        uint256 nonce;
        uint256 deadline;
    }

    address public treasury;
    string private baseTokenURI;
    mapping(uint256 nonce => bool) public nonceUsed;

    event LotSold(
        uint256 indexed tokenId,
        uint32 city,
        uint32 lot,
        address indexed buyer,
        address currency,
        uint256 price,
        uint256 indexed nonce
    );
    event TreasuryChanged(address treasury);
    event BaseURIChanged(string baseURI);

    error QuoteExpired();
    error NonceAlreadyUsed();
    error InvalidSigner(address recovered);
    error NotQuoteBuyer();
    error ZeroAddress();

    constructor(address admin, address treasury_, string memory baseURI_)
        ERC721("Smart Chain City Lot", "SCCLOT")
        EIP712("SCC LandNFT", "1")
    {
        if (admin == address(0) || treasury_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        treasury = treasury_;
        baseTokenURI = baseURI_;
    }

    /// @notice `tokenId` do lote: cidade nos 32 bits altos, número do lote nos 32 baixos.
    function lotId(uint32 city, uint32 lot) public pure returns (uint256) {
        return (uint256(city) << 32) | uint256(lot);
    }

    /// @notice Desfaz o `tokenId` em (cidade, lote).
    function lotOf(uint256 tokenId) public pure returns (uint32 city, uint32 lot) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return (uint32(tokenId >> 32), uint32(tokenId));
    }

    /// @notice Hash EIP-712 que o world assina. Exposto para o serviço e os testes conferirem.
    function quoteDigest(LotQuote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(QUOTE_TYPEHASH, q.city, q.lot, q.buyer, q.currency, q.price, q.nonce, q.deadline)
            )
        );
    }

    /// @notice Venda primária com cotação do world. Só o próprio comprador da cotação pode usá-la.
    function buyPrimary(LotQuote calldata q, bytes calldata signature)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (msg.sender != q.buyer) revert NotQuoteBuyer();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > q.deadline) revert QuoteExpired();
        if (nonceUsed[q.nonce]) revert NonceAlreadyUsed();
        address signer = ECDSA.recover(quoteDigest(q), signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert InvalidSigner(signer);

        nonceUsed[q.nonce] = true;
        tokenId = lotId(q.city, q.lot);
        // _mint, e não _safeMint: o comprador é quem chamou, e um callback aqui só abriria reentrada.
        // forge-lint: disable-next-line(unsafe-oz-erc721-mint)
        _mint(q.buyer, tokenId);
        // forge-lint: disable-next-line(reentrancy-events)
        emit LotSold(tokenId, q.city, q.lot, q.buyer, q.currency, q.price, q.nonce);
        // Cobrança por último (checks-effects-interactions).
        Payment.collect(q.currency, q.price, q.buyer, treasury);
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
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
