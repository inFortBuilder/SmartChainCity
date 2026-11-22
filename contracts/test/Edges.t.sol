// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IVRFCoordinatorV2Plus} from "../src/vrf/VRFV2Plus.sol";

import {AvatarNFT} from "../src/AvatarNFT.sol";
import {LuckyBox} from "../src/LuckyBox.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {SCityToken} from "../src/SCityToken.sol";
import {LocalVRFCoordinator} from "../src/dev/LocalVRFCoordinator.sol";

/// Coleção que diz ter EIP-2981 mas quebra no royaltyInfo, ou quebra já no supportsInterface.
contract BrokenRoyaltyNFT is ERC721 {
    bool public breakInterface;

    constructor(bool breakInterface_) ERC721("Broken", "BRK") {
        breakInterface = breakInterface_;
    }

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        require(!breakInterface, "quebrou");
        return id == 0x2a55205a || super.supportsInterface(id);
    }

    function royaltyInfo(uint256, uint256) external pure returns (address, uint256) {
        revert("quebrou");
    }
}

/// Bordas e funções de administração que a auditoria lê: cobertura das linhas críticas (doc 07 §5).
contract EdgesTest is Test {
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    SCityToken scity;
    Marketplace market;

    function setUp() public {
        scity = new SCityToken(admin);
        market = Marketplace(
            address(
                new ERC1967Proxy(
                    address(new Marketplace()),
                    abi.encodeCall(Marketplace.initialize, (admin, admin, scity, treasury, 250))
                )
            )
        );
        vm.prank(admin);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        scity.transfer(buyer, 100 ether);
    }

    function _one(address c, uint256 id) internal pure returns (Marketplace.Item[] memory items) {
        items = new Marketplace.Item[](1);
        items[0] = Marketplace.Item({collection: c, tokenId: id});
    }

    function test_initializeRejectsZeroAddresses() public {
        address impl = address(new Marketplace());
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        new ERC1967Proxy(impl, abi.encodeCall(Marketplace.initialize, (admin, admin, scity, address(0), 250)));
    }

    function test_adminSettersAndPause() public {
        vm.prank(admin);
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        market.setFee(address(0), 100);
        vm.prank(admin);
        market.setFee(seller, 500);
        assertEq(market.treasury(), seller);
        assertEq(market.feeBps(), 500);
        vm.startPrank(admin);
        market.pause();
        market.unpause();
        vm.stopPrank();
        assertFalse(market.paused());
        vm.prank(seller);
        vm.expectRevert();
        market.unpause();
    }

    function test_auctionChecksItemsApprovalAndReadsItems() public {
        BrokenRoyaltyNFT nft = new BrokenRoyaltyNFT(false);
        vm.prank(admin);
        market.setCollection(address(nft), true);
        nft.mint(seller, 1);
        nft.mint(seller, 2);
        Marketplace.Item[] memory twice = new Marketplace.Item[](2);
        twice[0] = Marketplace.Item({collection: address(nft), tokenId: 1});
        twice[1] = Marketplace.Item({collection: address(nft), tokenId: 1});
        vm.startPrank(seller);
        vm.expectRevert(abi.encodeWithSelector(Marketplace.NotApproved.selector, address(nft), 1));
        market.createAuction(_one(address(nft), 1), 1 ether, 1 days);
        // Aprovação de um token só (getApproved) também vale; repetido no mesmo leilão, não.
        nft.approve(address(market), 1);
        vm.expectRevert(Marketplace.BadItems.selector);
        market.createAuction(twice, 1 ether, 1 days);
        uint256 auctionId = market.createAuction(_one(address(nft), 1), 1 ether, 1 days);
        nft.approve(address(market), 2);
        uint256 listingId = market.list(_one(address(nft), 2), 3 ether, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        assertEq(market.auctionItemsOf(auctionId)[0].tokenId, 1);
        assertEq(market.itemsOf(listingId)[0].tokenId, 2);
    }

    function test_brokenRoyaltyCollectionsPayNoRoyalty() public {
        for (uint256 k; k < 2; ++k) {
            BrokenRoyaltyNFT nft = new BrokenRoyaltyNFT(k == 1);
            vm.prank(admin);
            market.setCollection(address(nft), true);
            nft.mint(seller, 1);
            vm.startPrank(seller);
            nft.setApprovalForAll(address(market), true);
            uint256 id = market.list(_one(address(nft), 1), 10 ether, uint64(block.timestamp + 1 days));
            vm.stopPrank();
            uint256 before = scity.balanceOf(seller);
            vm.startPrank(buyer);
            scity.approve(address(market), 10 ether);
            market.buy(id, 10 ether);
            vm.stopPrank();
            // Sem royalty: o vendedor recebe o preço menos a taxa de 2,5%.
            assertEq(scity.balanceOf(seller) - before, 9.75 ether);
            assertEq(nft.ownerOf(1), buyer);
        }
    }

    // ---------------------------------------------------------------- LuckyBox

    function _box() internal returns (LuckyBox box, LocalVRFCoordinator vrf) {
        vrf = new LocalVRFCoordinator();
        AvatarNFT avatar = new AvatarNFT(admin, treasury, 250, "");
        box = new LuckyBox(
            admin,
            avatar,
            treasury,
            LuckyBox.VrfConfig({
                coordinator: IVRFCoordinatorV2Plus(address(vrf)),
                keyHash: bytes32(uint256(1)),
                subId: 1,
                requestConfirmations: 3,
                callbackGasLimit: 300_000,
                nativePayment: false
            })
        );
    }

    function test_luckyBoxRejectsZeroAddresses() public {
        (LuckyBox box,) = _box();
        AvatarNFT avatar = box.avatar();
        LuckyBox.VrfConfig memory zero;
        vm.expectRevert(LuckyBox.ZeroAddress.selector);
        new LuckyBox(admin, avatar, address(0), zero);
    }

    function test_luckyBoxAdminAndViews() public {
        (LuckyBox box,) = _box();
        LuckyBox.VrfConfig memory zero;
        vm.startPrank(admin);
        vm.expectRevert(LuckyBox.ZeroAddress.selector);
        box.setTreasury(address(0));
        box.setTreasury(seller);
        vm.expectRevert(LuckyBox.ZeroAddress.selector);
        box.setVrf(zero);
        LocalVRFCoordinator other = new LocalVRFCoordinator();
        box.setVrf(
            LuckyBox.VrfConfig({
                coordinator: IVRFCoordinatorV2Plus(address(other)),
                keyHash: bytes32(uint256(2)),
                subId: 9,
                requestConfirmations: 3,
                callbackGasLimit: 300_000,
                nativePayment: true
            })
        );
        box.setTier(7, address(0), 1 ether, [uint16(7000), 2000, 900, 100], true);
        bytes32[] memory list = new bytes32[](1);
        list[0] = "padeiro";
        box.setProfessions(0, list);
        box.pause();
        assertTrue(box.paused());
        box.unpause();
        vm.stopPrank();

        assertEq(box.treasury(), seller);
        assertEq(box.tierOf(7).price, 1 ether);
        assertEq(box.professionsOf(0)[0], "padeiro");
        vm.prank(seller);
        vm.expectRevert();
        box.unpause();
    }

    /// Defensivo: com pesos que não somam 10.000 (o setTier recusa), o sorteio cai na última raridade.
    function test_pickRarityFallsBackToLast() public {
        (LuckyBox box,) = _box();
        assertEq(box.pickRarity([uint16(0), 0, 0, 0], 123), 3);
        assertEq(box.pickRarity([uint16(10_000), 0, 0, 0], 9999), 0);
    }

    function test_pausedMarketStopsAuctions() public {
        vm.prank(admin);
        market.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        market.createAuction(_one(address(1), 1), 1 ether, 1 days);
    }
}
