// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {AvatarNFT} from "../src/AvatarNFT.sol";

contract AvatarNFTTest is Test {
    AvatarNFT avatar;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address minter = makeAddr("minter");
    address player = makeAddr("player");

    function setUp() public {
        avatar = new AvatarNFT(admin, treasury, 250, "http://localhost:4002/v1/nft/avatars/");
        bytes32 role = avatar.MINTER_ROLE();
        vm.prank(admin);
        avatar.grantRole(role, minter);
    }

    function test_mintStoresTraits() public {
        vm.prank(minter);
        uint256 id = avatar.mint(player, 0, "padeiro");
        assertEq(id, 1);
        assertEq(avatar.ownerOf(id), player);
        AvatarNFT.Traits memory t = avatar.traitsOf(id);
        assertEq(t.rarity, 0);
        assertEq(t.profession, bytes32("padeiro"));
        assertEq(avatar.nextId(), 2);
    }

    function test_onlyMinterMints() public {
        bytes32 role = avatar.MINTER_ROLE();
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, player, role)
        );
        avatar.mint(player, 0, "padeiro");
    }

    function test_rejectsInvalidRarity() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(AvatarNFT.InvalidRarity.selector, 4));
        avatar.mint(player, 4, "padeiro");
    }

    function test_rejectsEmptyProfession() public {
        vm.prank(minter);
        vm.expectRevert(AvatarNFT.EmptyProfession.selector);
        avatar.mint(player, 1, bytes32(0));
    }

    function test_royaltyGoesToTreasury() public {
        vm.prank(minter);
        uint256 id = avatar.mint(player, 3, "engenheiro_civil");
        (address receiver, uint256 amount) = avatar.royaltyInfo(id, 1000 ether);
        assertEq(receiver, treasury);
        assertEq(amount, 25 ether); // 2,5%
    }

    function test_supportsInterfaces() public view {
        assertTrue(avatar.supportsInterface(type(IERC721).interfaceId));
        assertTrue(avatar.supportsInterface(type(IERC2981).interfaceId));
        assertTrue(avatar.supportsInterface(type(IAccessControl).interfaceId));
    }

    function test_tokenURI() public {
        vm.prank(minter);
        uint256 id = avatar.mint(player, 2, "arquiteto");
        assertEq(avatar.tokenURI(id), "http://localhost:4002/v1/nft/avatars/1");
    }

    function test_traitsOfUnknownTokenReverts() public {
        vm.expectRevert();
        avatar.traitsOf(99);
    }
}
