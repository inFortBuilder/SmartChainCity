// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AvatarNFT
/// @notice Smartcityanos (doc 07 §1, doc 02 §2). Raridade e profissão inicial ficam gravadas no mint e não
/// mudam. A profissão é o código do catálogo (ex.: "padeiro") em `bytes32`, o mesmo do Strapi e do
/// game-core, para não depender da ordem do catálogo. Royalties EIP-2981 para a tesouraria.
contract AvatarNFT is ERC721, ERC2981, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice 0 Comum, 1 Raro, 2 Épico, 3 Lendário.
    uint8 public constant RARITY_COUNT = 4;

    struct Traits {
        uint8 rarity;
        bytes32 profession;
    }

    uint256 public nextId = 1;
    string private baseTokenURI;
    mapping(uint256 tokenId => Traits) private traits;

    event AvatarMinted(uint256 indexed tokenId, address indexed to, uint8 rarity, bytes32 profession);
    event BaseURIChanged(string baseURI);

    error InvalidRarity(uint8 rarity);
    error EmptyProfession();

    constructor(address admin, address royaltyReceiver, uint96 royaltyBps, string memory baseURI_)
        ERC721("Smartcityano", "SCCAVATAR")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setDefaultRoyalty(royaltyReceiver, royaltyBps);
        baseTokenURI = baseURI_;
    }

    /// @notice Cria o avatar. Usa `_mint` (sem callback) porque o minter principal é o callback do VRF,
    /// que não pode reverter por causa de uma carteira de contrato que recusa o NFT.
    function mint(address to, uint8 rarity, bytes32 profession)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        if (rarity >= RARITY_COUNT) revert InvalidRarity(rarity);
        if (profession == bytes32(0)) revert EmptyProfession();
        tokenId = nextId++;
        traits[tokenId] = Traits(rarity, profession);
        // forge-lint: disable-next-line(unsafe-oz-erc721-mint)
        _mint(to, tokenId);
        emit AvatarMinted(tokenId, to, rarity, profession);
    }

    function traitsOf(uint256 tokenId) external view returns (Traits memory) {
        _requireOwned(tokenId);
        return traits[tokenId];
    }

    function setBaseURI(string calldata baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseTokenURI = baseURI_;
        emit BaseURIChanged(baseURI_);
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setDefaultRoyalty(receiver, bps);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
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
