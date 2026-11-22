// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {GameVault} from "../../src/GameVault.sol";
import {SCityToken} from "../../src/SCityToken.sol";

/// Ações aleatórias no cofre (fuzz com estado): depósitos, saques com voucher, desistências e dias passando.
contract VaultHandler is Test {
    GameVault public vault;
    SCityToken public scity;
    uint256 internal signerKey;
    address[] public actors;

    // Contabilidade fantasma: o que o teste sabe que entrou e saiu.
    uint256 public deposited;
    uint256 public claimed;
    uint256 public nextNonce = 1;
    uint256[] public days_;
    uint256[] public cancelledNonces;
    mapping(uint256 nonce => GameVault.Withdrawal) internal issued;
    mapping(uint256 nonce => bool) public paid;

    constructor(GameVault vault_, SCityToken scity_, uint256 signerKey_, address[] memory actors_) {
        vault = vault_;
        scity = scity_;
        signerKey = signerKey_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _sign(GameVault.Withdrawal memory w) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, vault.withdrawalDigest(w));
        return abi.encodePacked(r, s, v);
    }

    function deposit(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        amount = bound(amount, 1, scity.balanceOf(a) == 0 ? 1 : scity.balanceOf(a));
        if (scity.balanceOf(a) < amount) return;
        vm.startPrank(a);
        scity.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
        deposited += amount;
    }

    /// O servidor emite um voucher e o destinatário tenta resgatar (pode reverter pelo teto do dia).
    function claim(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        amount = bound(amount, 1, 500 ether);
        GameVault.Withdrawal memory w = GameVault.Withdrawal({
            to: a, amount: amount, nonce: nextNonce++, deadline: block.timestamp + 2 days
        });
        issued[w.nonce] = w;
        bytes memory sig = _sign(w);
        vm.prank(a);
        try vault.claim(w, sig) {
            claimed += amount;
            paid[w.nonce] = true;
            days_.push(block.timestamp / 1 days);
        } catch {}
    }

    /// O servidor emite um voucher que ninguém resgata ainda (fica para depois, ou para a desistência).
    function issue(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        amount = bound(amount, 1, 500 ether);
        issued[nextNonce] = GameVault.Withdrawal({
            to: a, amount: amount, nonce: nextNonce, deadline: block.timestamp + 2 days
        });
        nextNonce++;
    }

    /// O destinatário desiste de um voucher emitido (pago ou não; o pago recusa).
    function cancel(uint256 which) external {
        if (nextNonce == 1) return;
        uint256 nonce = bound(which, 1, nextNonce - 1);
        GameVault.Withdrawal memory w = issued[nonce];
        bytes memory sig = _sign(w);
        vm.prank(w.to);
        try vault.cancelVoucher(w, sig) {
            cancelledNonces.push(nonce);
        } catch {}
    }

    /// Resgate atrasado de um voucher antigo (pode vir depois de cancelado: tem de recusar).
    function claimOld(uint256 which) external {
        if (nextNonce == 1) return;
        uint256 nonce = bound(which, 1, nextNonce - 1);
        GameVault.Withdrawal memory w = issued[nonce];
        bytes memory sig = _sign(w);
        vm.prank(w.to);
        try vault.claim(w, sig) {
            claimed += w.amount;
            paid[nonce] = true;
            days_.push(block.timestamp / 1 days);
        } catch {}
    }

    function passTime(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 2 days));
    }

    function daysCount() external view returns (uint256) {
        return days_.length;
    }

    function cancelledCount() external view returns (uint256) {
        return cancelledNonces.length;
    }
}

contract GameVaultInvariantTest is Test {
    uint256 constant DAILY = 1000 ether;
    uint256 constant PER_ADDRESS = 400 ether;
    uint256 constant RESERVE = 100_000 ether;

    GameVault vault;
    SCityToken scity;
    VaultHandler handler;
    address[] actors;

    function setUp() public {
        address admin = makeAddr("admin");
        (address signer, uint256 signerKey) = makeAddrAndKey("signer");
        scity = new SCityToken(admin);
        vault = GameVault(
            address(
                new ERC1967Proxy(
                    address(new GameVault()),
                    abi.encodeCall(GameVault.initialize, (admin, admin, scity, DAILY, PER_ADDRESS))
                )
            )
        );
        for (uint256 i; i < 4; ++i) {
            actors.push(makeAddr(string.concat("ator", vm.toString(i))));
        }
        vm.startPrank(admin);
        vault.grantRole(vault.SIGNER_ROLE(), signer);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        scity.transfer(address(vault), RESERVE);
        for (uint256 i; i < actors.length; ++i) {
            // forge-lint: disable-next-line(erc20-unchecked-transfer)
            scity.transfer(actors[i], 5000 ether);
        }
        vm.stopPrank();
        vm.warp(30 days);
        handler = new VaultHandler(vault, scity, signerKey, actors);
        targetContract(address(handler));
    }

    /// Os caminhos de verdade foram exercitados na sequência (visível com -vv).
    function afterInvariant() public view {
        console.log("depositado", handler.deposited() / 1 ether, "sacado", handler.claimed() / 1 ether);
        console.log("dias com saque", handler.daysCount(), "cancelados", handler.cancelledCount());
    }

    /// O cofre guarda exatamente a reserva mais os depósitos menos os saques pagos.
    function invariant_balanceMatchesFlows() public view {
        assertEq(scity.balanceOf(address(vault)), RESERVE + handler.deposited() - handler.claimed());
    }

    /// Nenhum dia passou do teto total, nem algum endereço do teto por endereço (circuit breaker).
    function invariant_dailyLimits() public view {
        uint256 n = handler.daysCount();
        for (uint256 i; i < n; ++i) {
            uint256 d = handler.days_(i);
            assertLe(vault.withdrawnOn(d), DAILY);
            for (uint256 k; k < actors.length; ++k) {
                assertLe(vault.withdrawnBy(d, actors[k]), PER_ADDRESS);
            }
        }
    }

    /// Voucher cancelado nunca é pago, e cada nonce usado fica marcado.
    function invariant_cancelledNeverPaid() public view {
        uint256 n = handler.cancelledCount();
        for (uint256 i; i < n; ++i) {
            uint256 nonce = handler.cancelledNonces(i);
            assertFalse(handler.paid(nonce));
            assertTrue(vault.nonceCancelled(nonce));
            assertTrue(vault.nonceUsed(nonce));
        }
    }
}
