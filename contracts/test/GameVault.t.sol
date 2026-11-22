// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

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
        // Pelo proxy, como na rede (o timelock é o admin aqui, nos testes de upgrade é um TimelockController).
        vault = GameVault(
            address(
                new ERC1967Proxy(
                    address(new GameVault()),
                    abi.encodeCall(GameVault.initialize, (admin, admin, scity, DAILY, PER_ADDRESS))
                )
            )
        );
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

    function permitSig(uint256 key, address owner, uint256 amount, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 typehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash =
            keccak256(abi.encode(typehash, owner, address(vault), amount, scity.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", scity.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(key, digest);
    }

    function test_depositWithPermitInOneTx() public {
        (address carol, uint256 carolKey) = makeAddrAndKey("carol");
        vm.prank(admin);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        scity.transfer(carol, 50 ether);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = permitSig(carolKey, carol, 50 ether, deadline);
        vm.expectEmit(address(vault));
        emit GameVault.Deposited(carol, 50 ether);
        vm.prank(carol);
        vault.depositWithPermit(50 ether, deadline, v, r, s);
        assertEq(scity.balanceOf(carol), 0);
        assertEq(scity.allowance(carol, address(vault)), 0);
    }

    function test_depositWithPermitSurvivesFrontRunAndRejectsBadSig() public {
        (address carol, uint256 carolKey) = makeAddrAndKey("carol");
        vm.prank(admin);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        scity.transfer(carol, 50 ether);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = permitSig(carolKey, carol, 20 ether, deadline);
        // Alguém usa o permit antes: o depósito passa mesmo assim.
        scity.permit(carol, address(vault), 20 ether, deadline, v, r, s);
        vm.prank(carol);
        vault.depositWithPermit(20 ether, deadline, v, r, s);
        assertEq(scity.balanceOf(carol), 30 ether);
        // Assinatura de outra chave: sem autorização, a transferência reverte.
        (v, r, s) = permitSig(signerKey, carol, 10 ether, deadline);
        vm.prank(carol);
        vm.expectRevert();
        vault.depositWithPermit(10 ether, deadline, v, r, s);
        vm.prank(carol);
        vm.expectRevert(GameVault.ZeroAmount.selector);
        vault.depositWithPermit(0, deadline, v, r, s);
    }

    function test_cancelVoucherBurnsNonceWithoutPaying() public {
        GameVault.Withdrawal memory w = voucher(bob, 100 ether, 9);
        bytes memory sig = sign(w, signerKey);
        // Só o destinatário cancela, e só um voucher assinado pelo servidor.
        vm.prank(alice);
        vm.expectRevert(GameVault.NotRecipient.selector);
        vault.cancelVoucher(w, sig);
        bytes memory fake = sign(w, 0xBEEF);
        vm.prank(bob);
        vm.expectRevert();
        vault.cancelVoucher(w, fake);
        // Vale com o cofre pausado: nada sai dele.
        vm.prank(admin);
        vault.pause();
        vm.expectEmit(address(vault));
        emit GameVault.VoucherCancelled(bob, 9);
        vm.prank(bob);
        vault.cancelVoucher(w, sig);
        assertTrue(vault.nonceUsed(9));
        assertTrue(vault.nonceCancelled(9));
        assertEq(scity.balanceOf(bob), 0);
        vm.prank(admin);
        vault.unpause();
        vm.prank(bob);
        vm.expectRevert(GameVault.NonceAlreadyUsed.selector);
        vault.claim(w, sig);
        vm.prank(bob);
        vm.expectRevert(GameVault.NonceAlreadyUsed.selector);
        vault.cancelVoucher(w, sig);
    }

    function test_claimedVoucherCannotBeCancelled() public {
        GameVault.Withdrawal memory w = voucher(bob, 10 ether, 3);
        claimAs(bob, w);
        bytes memory sig = sign(w, signerKey);
        vm.prank(bob);
        vm.expectRevert(GameVault.NonceAlreadyUsed.selector);
        vault.cancelVoucher(w, sig);
        assertFalse(vault.nonceCancelled(3));
    }

    function test_availableTracksLimitsReserveAndLoweredLimit() public {
        (uint256 total, uint256 mine) = vault.available(bob);
        assertEq(total, DAILY);
        assertEq(mine, PER_ADDRESS);
        claimAs(bob, voucher(bob, 300 ether, 1));
        (total, mine) = vault.available(bob);
        assertEq(total, 700 ether);
        assertEq(mine, 100 ether);
        (, mine) = vault.available(alice);
        assertEq(mine, PER_ADDRESS);
        // O admin baixa o teto abaixo do que já saiu: nada sobra, e o claim reverte com 0 (sem underflow).
        vm.prank(admin);
        vault.setLimits(200 ether, 100 ether);
        (total, mine) = vault.available(alice);
        assertEq(total, 0);
        assertEq(mine, 0);
        GameVault.Withdrawal memory w = voucher(alice, 1 ether, 2);
        bytes memory sig = sign(w, signerKey);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GameVault.DailyLimitExceeded.selector, 0));
        vault.claim(w, sig);
        // A reserva do cofre também limita.
        vm.prank(admin);
        vault.setLimits(1_000_000 ether, 1_000_000 ether);
        vm.warp(block.timestamp + 1 days);
        (total, mine) = vault.available(alice);
        assertEq(total, scity.balanceOf(address(vault)));
        assertEq(mine, total);
    }
}
