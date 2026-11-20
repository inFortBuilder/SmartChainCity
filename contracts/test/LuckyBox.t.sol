// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {AvatarNFT} from "../src/AvatarNFT.sol";
import {LuckyBox} from "../src/LuckyBox.sol";
import {LocalVRFCoordinator} from "../src/dev/LocalVRFCoordinator.sol";
import {IVRFCoordinatorV2Plus} from "../src/vrf/VRFV2Plus.sol";

contract LuckyBoxTest is Test {
    AvatarNFT avatar;
    LuckyBox box;
    LocalVRFCoordinator vrf;
    ERC20Mock stable;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address player = makeAddr("player");

    uint16[4] shares = [uint16(4000), 3000, 2000, 1000];

    function setUp() public {
        vrf = new LocalVRFCoordinator();
        avatar = new AvatarNFT(admin, treasury, 250, "");
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
        stable = new ERC20Mock();

        vm.startPrank(admin);
        avatar.grantRole(avatar.MINTER_ROLE(), address(box));
        box.setTier(1, address(0), 0.1 ether, shares, true);
        box.setTier(2, address(stable), 150 ether, shares, true);
        bytes32[] memory list = new bytes32[](2);
        list[0] = "padeiro";
        list[1] = "pedreiro";
        box.setProfessions(0, list);
        list[0] = "confeiteiro";
        list[1] = "construtor";
        box.setProfessions(1, list);
        bytes32[] memory one = new bytes32[](1);
        one[0] = "arquiteto";
        box.setProfessions(2, one);
        one[0] = "chef";
        box.setProfessions(3, one);
        vm.stopPrank();

        vm.deal(player, 10 ether);
        stable.mint(player, 1000 ether);
    }

    function words(uint256 w) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = w;
    }

    function test_openWithNativeAndReveal() public {
        vm.prank(player);
        uint256 rid = box.open{value: 0.1 ether}(1);
        assertEq(treasury.balance, 0.1 ether);
        assertEq(avatar.nextId(), 1, "nada mintado antes do VRF");

        vrf.fulfillWithWords(rid, words(123_456));

        assertEq(avatar.ownerOf(1), player);
        AvatarNFT.Traits memory t = avatar.traitsOf(1);
        uint8 expected = box.pickRarity(shares, uint256(keccak256(abi.encode(uint256(123_456), 0))));
        assertEq(t.rarity, expected);
        assertTrue(box.requestOf(rid).fulfilled);
    }

    function test_openWithStablecoin() public {
        vm.startPrank(player);
        stable.approve(address(box), 150 ether);
        uint256 rid = box.open(2);
        vm.stopPrank();
        assertEq(stable.balanceOf(treasury), 150 ether);
        vrf.fulfill(rid);
        assertEq(avatar.ownerOf(1), player);
    }

    function test_onlyCoordinatorFulfills() public {
        vm.prank(player);
        uint256 rid = box.open{value: 0.1 ether}(1);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(LuckyBox.OnlyCoordinator.selector, player));
        box.rawFulfillRandomWords(rid, words(1));
    }

    function test_cannotFulfillTwice() public {
        vm.prank(player);
        uint256 rid = box.open{value: 0.1 ether}(1);
        vm.startPrank(address(vrf));
        box.rawFulfillRandomWords(rid, words(1));
        vm.expectRevert(abi.encodeWithSelector(LuckyBox.AlreadyFulfilled.selector, rid));
        box.rawFulfillRandomWords(rid, words(2));
        vm.stopPrank();
    }

    function test_unknownRequestReverts() public {
        vm.prank(address(vrf));
        vm.expectRevert(abi.encodeWithSelector(LuckyBox.UnknownRequest.selector, 77));
        box.rawFulfillRandomWords(77, words(1));
    }

    function test_inactiveTierReverts() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(LuckyBox.TierInactive.selector, 9));
        box.open{value: 0.1 ether}(9);
    }

    function test_weightsMustSumToTotal() public {
        uint16[4] memory bad = [uint16(5000), 3000, 2000, 1000];
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(LuckyBox.WeightsMustSum.selector, 11_000));
        box.setTier(3, address(0), 1, bad, true);
    }

    /// Uma raridade sorteável sem profissão travaria o callback: a compra é recusada antes de cobrar.
    function test_openRequiresProfessionsForEveryDrawableRarity() public {
        LuckyBox fresh = new LuckyBox(admin, avatar, treasury, box.vrfConfig());
        vm.prank(admin);
        fresh.setTier(1, address(0), 0, shares, true);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(LuckyBox.NoProfessions.selector, 0));
        fresh.open(1);
    }

    /// A tabela do momento da compra vale, mesmo que o admin mude o tier antes do sorteio.
    function test_weightsAreSnapshottedAtOpen() public {
        vm.prank(player);
        uint256 rid = box.open{value: 0.1 ether}(1);
        uint16[4] memory onlyLegendary = [uint16(0), 0, 0, 10_000];
        vm.prank(admin);
        box.setTier(1, address(0), 0.1 ether, onlyLegendary, true);

        // Palavra que cai em Comum na tabela original.
        uint256 w;
        while (box.pickRarity(shares, uint256(keccak256(abi.encode(w, 0)))) != 0) w++;
        vrf.fulfillWithWords(rid, words(w));
        assertEq(avatar.traitsOf(1).rarity, 0);
    }

    function test_pauseBlocksOpen() public {
        vm.prank(admin);
        box.pause();
        vm.prank(player);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        box.open{value: 0.1 ether}(1);
    }

    function test_pickRarityBoundaries() public view {
        assertEq(box.pickRarity(shares, 0), 0);
        assertEq(box.pickRarity(shares, 3999), 0);
        assertEq(box.pickRarity(shares, 4000), 1);
        assertEq(box.pickRarity(shares, 6999), 1);
        assertEq(box.pickRarity(shares, 7000), 2);
        assertEq(box.pickRarity(shares, 8999), 2);
        assertEq(box.pickRarity(shares, 9000), 3);
        assertEq(box.pickRarity(shares, 9999), 3);
        assertEq(box.pickRarity(shares, 10_000), 0); // volta pelo módulo
    }

    /// Trilha de contratos, passo 3: distribuição dentro de ±1 ponto percentual.
    function test_distributionWithinOnePercent() public view {
        uint256 n = 40_000;
        uint256[4] memory hits;
        for (uint256 i; i < n; ++i) {
            uint256 word = uint256(keccak256(abi.encode("scc-luckybox", i)));
            hits[box.pickRarity(shares, uint256(keccak256(abi.encode(word, 0))))]++;
        }
        for (uint8 r; r < 4; ++r) {
            uint256 expected = n * shares[r] / 10_000;
            uint256 diff = hits[r] > expected ? hits[r] - expected : expected - hits[r];
            assertLe(diff * 100, n, "raridade fora de +-1%");
        }
    }

    function testFuzz_revealAlwaysMintsAValidAvatar(uint256 word) public {
        vm.prank(player);
        uint256 rid = box.open{value: 0.1 ether}(1);
        vrf.fulfillWithWords(rid, words(word));
        AvatarNFT.Traits memory t = avatar.traitsOf(1);
        assertLt(t.rarity, 4);
        assertTrue(t.profession != bytes32(0));
    }
}
