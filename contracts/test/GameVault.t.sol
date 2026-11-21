// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {GameVault} from "../src/GameVault.sol";
import {SCityToken} from "../src/SCityToken.sol";

contract GameVaultTest is Test {
    SCityToken scity;
    GameVault vault;

    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 signerKey;
    address signer;

    uint256 constant DAILY = 1000 ether;
    uint256 constant PER_ADDRESS = 400 ether;

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("economy-signer");
        scity = new SCityToken(admin);
        vault = new GameVault(admin, scity, DAILY, PER_ADDRESS);
        vm.startPrank(admin);
        vault.grantRole(vault.SIGNER_ROLE(), signer);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        scity.transfer(alice, 5000 ether);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        scity.transfer(address(vault), 10_000 ether); // reserva para os saques
        vm.stopPrank();
        vm.warp(30 days);
    }

    function voucher(address to, uint256 amount, uint256 nonce)
        internal
        view
        returns (GameVault.Withdrawal memory)
    {
        // forge-lint: disable-next-line(environment-read-across-mutation)
        return GameVault.Withdrawal({to: to, amount: amount, nonce: nonce, deadline: block.timestamp + 600});
    }

    function sign(GameVault.Withdrawal memory w, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, vault.withdrawalDigest(w));
        return abi.encodePacked(r, s, v);
    }

    function claimAs(address who, GameVault.Withdrawal memory w) internal {
        bytes memory sig = sign(w, signerKey);
        vm.prank(who);
        vault.claim(w, sig);
    }

    function test_depositMovesTokensAndEmits() public {
        vm.startPrank(alice);
        scity.approve(address(vault), 100 ether);
        vm.expectEmit(address(vault));
        emit GameVault.Deposited(alice, 100 ether);
        vault.deposit(100 ether);
        vm.stopPrank();
        assertEq(scity.balanceOf(alice), 4900 ether);
        assertEq(scity.balanceOf(address(vault)), 10_100 ether);
    }

    function test_depositRejectsZeroAndNoAllowance() public {
        vm.startPrank(alice);
        vm.expectRevert(GameVault.ZeroAmount.selector);
        vault.deposit(0);
        vm.expectRevert();
        vault.deposit(1 ether);
        vm.stopPrank();
    }

    function test_claimPaysOnceAndEmits() public {
        GameVault.Withdrawal memory w = voucher(bob, 100 ether, 7);
        bytes memory sig = sign(w, signerKey);
        vm.expectEmit(address(vault));
        emit GameVault.Withdrawn(bob, 100 ether, 7);
        vm.prank(bob);
        vault.claim(w, sig);
        assertEq(scity.balanceOf(bob), 100 ether);
        assertTrue(vault.nonceUsed(7));

        vm.prank(bob);
        vm.expectRevert(GameVault.NonceAlreadyUsed.selector);
        vault.claim(w, sig);
    }

    function test_claimRejectsWrongSignerCallerExpiredAndTamper() public {
        GameVault.Withdrawal memory w = voucher(bob, 100 ether, 1);
        (address fake, uint256 fakeKey) = makeAddrAndKey("falso");
        bytes memory bad = sign(w, fakeKey);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(GameVault.InvalidSigner.selector, fake));
        vault.claim(w, bad);

        bytes memory sig = sign(w, signerKey);
        vm.prank(alice);
        vm.expectRevert(GameVault.NotRecipient.selector);
        vault.claim(w, sig);

        GameVault.Withdrawal memory more = w;
        more.amount = 300 ether; // o jogador tenta sacar mais do que o assinado
        vm.prank(bob);
        vm.expectRevert();
        vault.claim(more, sig);

        vm.warp(w.deadline + 1);
        vm.prank(bob);
        vm.expectRevert(GameVault.VoucherExpired.selector);
        vault.claim(w, sig);
    }

    function test_perAddressLimitResetsNextDay() public {
        claimAs(bob, voucher(bob, 300 ether, 1));
        GameVault.Withdrawal memory w = voucher(bob, 200 ether, 2);
        bytes memory sig = sign(w, signerKey);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(GameVault.AddressLimitExceeded.selector, 100 ether));
        vault.claim(w, sig);

        // No dia seguinte, o mesmo voucher passa (se ainda estiver no prazo).
        GameVault.Withdrawal memory late = w;
        late.deadline = block.timestamp + 2 days;
        bytes memory lateSig = sign(late, signerKey);
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        vault.claim(late, lateSig);
        assertEq(scity.balanceOf(bob), 500 ether);
    }

    function test_globalLimitAcrossAddresses() public {
        address[3] memory who = [bob, makeAddr("c"), makeAddr("d")];
        claimAs(who[0], voucher(who[0], 400 ether, 1));
        claimAs(who[1], voucher(who[1], 400 ether, 2));
        GameVault.Withdrawal memory w = voucher(who[2], 300 ether, 3);
        bytes memory sig = sign(w, signerKey);
        vm.prank(who[2]);
        vm.expectRevert(abi.encodeWithSelector(GameVault.DailyLimitExceeded.selector, 200 ether));
        vault.claim(w, sig);
    }

    function test_pauseBlocksDepositAndClaim() public {
        vm.prank(admin);
        vault.pause();
        GameVault.Withdrawal memory w = voucher(bob, 1 ether, 1);
        bytes memory sig = sign(w, signerKey);
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.claim(w, sig);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(1 ether);
    }

    function test_onlyAdminChangesLimits() public {
        vm.prank(bob);
        vm.expectRevert();
        vault.setLimits(1, 1);
        vm.expectEmit(address(vault));
        emit GameVault.LimitsChanged(5000 ether, 1000 ether);
        vm.prank(admin);
        vault.setLimits(5000 ether, 1000 ether);
        assertEq(vault.dailyLimitPerAddress(), 1000 ether);
    }

    function testFuzz_neverPaysMoreThanLimitsInADay(uint96[5] memory amounts) public {
        uint256 paid;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 amount = bound(uint256(amounts[i]), 1, 600 ether);
            GameVault.Withdrawal memory w = voucher(bob, amount, i + 1);
            bytes memory sig = sign(w, signerKey);
            vm.prank(bob);
            try vault.claim(w, sig) {
                paid += amount;
            } catch {}
        }
        assertLe(paid, PER_ADDRESS);
        assertEq(scity.balanceOf(bob), paid);
    }
}
