// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {GameVault} from "../src/GameVault.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {SCityToken} from "../src/SCityToken.sol";

/// Versão 2 de teste: só acrescenta uma função, sem mexer no armazenamento.
contract GameVaultV2 is GameVault {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract MarketplaceV2 is Marketplace {
    function version() external pure returns (uint256) {
        return 2;
    }
}

/// Upgrade (doc 07 §5): UUPS no GameVault e no Marketplace, sempre atrás do TimelockController.
contract UpgradesTest is Test {
    uint256 constant DELAY = 2 days;

    SCityToken scity;
    TimelockController timelock;
    GameVault vault;
    Marketplace market;

    address admin = makeAddr("admin");
    address multisig = makeAddr("multisig");
    address attacker = makeAddr("attacker");
    address treasury = makeAddr("treasury");

    function setUp() public {
        scity = new SCityToken(admin);
        address[] memory proposers = new address[](1);
        proposers[0] = multisig;
        address[] memory executors = new address[](1);
        executors[0] = multisig;
        // Sem admin próprio: o timelock só muda a si mesmo pelo próprio atraso.
        timelock = new TimelockController(DELAY, proposers, executors, address(0));
        vault = GameVault(
            address(
                new ERC1967Proxy(
                    address(new GameVault()),
                    abi.encodeCall(
                        GameVault.initialize, (admin, address(timelock), scity, 1000 ether, 400 ether)
                    )
                )
            )
        );
        market = Marketplace(
            address(
                new ERC1967Proxy(
                    address(new Marketplace()),
                    abi.encodeCall(Marketplace.initialize, (admin, address(timelock), scity, treasury, 250))
                )
            )
        );
    }

    function _schedule(address target, bytes memory data, bytes32 salt) internal {
        vm.prank(multisig);
        timelock.schedule(target, 0, data, bytes32(0), salt, DELAY);
    }

    function _execute(address target, bytes memory data, bytes32 salt) internal {
        vm.prank(multisig);
        timelock.execute(target, 0, data, bytes32(0), salt);
    }

    function test_implementationIsLockedAndProxyInitializesOnce() public {
        GameVault impl = new GameVault();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(admin, admin, scity, 1, 1);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vault.initialize(attacker, attacker, scity, 1, 1);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        market.initialize(attacker, attacker, scity, attacker, 0);
        // O estado do proxy é o da inicialização.
        assertEq(address(vault.token()), address(scity));
        assertEq(vault.dailyLimit(), 1000 ether);
        assertEq(market.feeBps(), 250);
        // Os contadores começam em 1 no proxy também (0 é "sem listagem").
        assertEq(market.nextListingId(), 1);
        assertEq(market.nextAuctionId(), 1);
        assertTrue(vault.hasRole(vault.UPGRADER_ROLE(), address(timelock)));
        assertFalse(vault.hasRole(vault.UPGRADER_ROLE(), admin));
    }

    function test_onlyTimelockUpgrades() public {
        address v2 = address(new GameVaultV2());
        bytes32 upgrader = vault.UPGRADER_ROLE();
        // Nem o admin nem um estranho trocam a implementação direto.
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? admin : attacker;
            vm.prank(who);
            vm.expectRevert(
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector, who, upgrader
                )
            );
            vault.upgradeToAndCall(v2, "");
        }
        // Só o multisig propõe no timelock.
        bytes memory call = abi.encodeCall(vault.upgradeToAndCall, (v2, ""));
        vm.prank(attacker);
        vm.expectRevert();
        timelock.schedule(address(vault), 0, call, bytes32(0), bytes32(0), DELAY);
    }

    function test_upgradeThroughTimelockKeepsState() public {
        // Estado antes: limites mudados, um depósito e uma listagem.
        vm.prank(admin);
        vault.setLimits(5000 ether, 900 ether);
        vm.startPrank(admin);
        scity.approve(address(vault), 10 ether);
        vault.deposit(10 ether);
        vm.stopPrank();

        address v2 = address(new GameVaultV2());
        bytes memory call = abi.encodeCall(vault.upgradeToAndCall, (v2, ""));
        _schedule(address(vault), call, "v2");
        // Antes do atraso, não executa.
        vm.prank(multisig);
        vm.expectRevert();
        timelock.execute(address(vault), 0, call, bytes32(0), "v2");
        vm.warp(block.timestamp + DELAY);
        _execute(address(vault), call, "v2");

        assertEq(GameVaultV2(address(vault)).version(), 2);
        assertEq(address(uint160(uint256(vm.load(address(vault), ERC1967Utils.IMPLEMENTATION_SLOT)))), v2);
        assertEq(vault.dailyLimit(), 5000 ether);
        assertEq(vault.dailyLimitPerAddress(), 900 ether);
        assertEq(scity.balanceOf(address(vault)), 10 ether);
        assertTrue(vault.hasRole(vault.DEFAULT_ADMIN_ROLE(), admin));

        // O Marketplace pelo mesmo caminho.
        address m2 = address(new MarketplaceV2());
        bytes memory mcall = abi.encodeCall(market.upgradeToAndCall, (m2, ""));
        _schedule(address(market), mcall, "m2");
        vm.warp(block.timestamp + DELAY);
        _execute(address(market), mcall, "m2");
        assertEq(MarketplaceV2(address(market)).version(), 2);
        assertEq(market.treasury(), treasury);
        assertEq(market.feeBps(), 250);
    }

    function test_upgradeToNonUupsIsRejected() public {
        // Uma implementação sem proxiableUUID travaria o proxy: o UUPS recusa.
        bytes memory call = abi.encodeCall(vault.upgradeToAndCall, (address(scity), ""));
        _schedule(address(vault), call, "ruim");
        vm.warp(block.timestamp + DELAY);
        vm.prank(multisig);
        vm.expectRevert();
        timelock.execute(address(vault), 0, call, bytes32(0), "ruim");
    }
}
