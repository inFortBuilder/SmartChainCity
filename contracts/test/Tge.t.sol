// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

import {DeployTGE} from "../script/DeployTGE.s.sol";
import {SCityToken} from "../src/SCityToken.sol";
import {RewardsPool} from "../src/tge/RewardsPool.sol";
import {TgeDistributor} from "../src/tge/TgeDistributor.sol";
import {TokenLock} from "../src/tge/TokenLock.sol";

/// O TGE com a config de exemplo: o cronograma simulado bate com a tabela do doc 04 §2 e §3.
contract TgeTest is Test {
    DeployTGE script;
    TgeDistributor tge;
    SCityToken scity;
    uint256 constant M = 1_000_000 ether; // um milhão de SCITY
    uint64 constant MONTH = 365 days / 12;
    uint256 t0;
    mapping(bytes32 => address) who;

    function setUp() public {
        vm.chainId(97);
        vm.warp(1_800_000_000);
        t0 = block.timestamp;
        script = new DeployTGE();
        (TgeDistributor.Allocation[] memory allocs, TgeDistributor.Rewards memory rewards) =
            script.loadConfig(vm.readFile("deploy/tge.example.json"));
        rewards.beneficiary = makeAddr("p2e");
        for (uint256 i; i < allocs.length; ++i) {
            allocs[i].beneficiary = makeAddr(string(abi.encodePacked(allocs[i].name)));
            who[allocs[i].name] = allocs[i].beneficiary;
        }
        tge = script.deploy(allocs, rewards, address(script));
        scity = tge.token();
    }

    function _grant(bytes32 name) internal view returns (TgeDistributor.Grant memory g) {
        TgeDistributor.Grant[] memory all = tge.grants();
        for (uint256 i; i < all.length; ++i) {
            if (all[i].name == name) return all[i];
        }
        revert("sem alocacao");
    }

    function _vested(bytes32 name) internal view returns (uint256) {
        TgeDistributor.Grant memory g = _grant(name);
        uint256 v = g.vesting == address(0)
            ? 0
            : VestingWallet(payable(g.vesting)).vestedAmount(address(scity), uint64(block.timestamp));
        return g.atTge + v;
    }

    function test_supplyDistributedNothingLeft() public view {
        assertEq(scity.totalSupply(), 1_000_000_000 ether);
        assertEq(scity.balanceOf(address(tge)), 0);
        assertEq(scity.balanceOf(address(script)), 0);
        assertEq(tge.grants().length, 12);
        assertEq(scity.balanceOf(address(tge.rewardsPool())), 410 * M);
        // Direto no TGE: liquidez (60), ação social (10), airdrop (10), 10% do marketing (7), 25% do ICO (8,75).
        assertEq(scity.balanceOf(who["Liquidez (pool)"]), 30 * M);
        assertEq(scity.balanceOf(who["Marketing"]), 7 * M);
        assertEq(scity.balanceOf(who["ICO"]), 8.75 ether * 1_000_000);
        assertEq(scity.balanceOf(who["Team"]), 0);
    }

    function test_scheduleMatchesDoc04() public {
        // No TGE.
        assertEq(_vested("Team"), 0);
        assertEq(_vested("Marketing"), 7 * M);
        assertEq(tge.rewardsPool().releasable(), 123 * M); // ano 1: 30% do P2E

        // 6 meses: ICO inteiro; advisors e staff ainda no cliff.
        vm.warp(t0 + 6 * MONTH);
        assertEq(_vested("ICO"), 35 * M);
        assertEq(_vested("Advisors"), 0);
        assertEq(_vested("STAFF"), 0);
        assertEq(_vested("Staking"), 20 * M); // 6/60 de 200

        // 12 meses: fim do cliff de DEV e Team; staff na metade (6 de 12 meses lineares).
        vm.warp(t0 + 12 * MONTH);
        assertEq(_vested("Team"), 0);
        assertEq(_vested("STAFF"), 2.5 ether * 1_000_000);
        assertEq(_vested("Advisors"), 10 * M / 3); // 6 de 18 meses

        // 24 meses: metade de DEV e Team; advisors e staff inteiros.
        vm.warp(t0 + 24 * MONTH);
        assertEq(_vested("DEV"), 47.5 ether * 1_000_000);
        assertEq(_vested("Advisors"), 10 * M);
        assertEq(_vested("STAFF"), 5 * M);

        // 36 meses: DEV, Team e marketing inteiros; staking em 36/60.
        vm.warp(t0 + 36 * MONTH);
        assertEq(_vested("Team"), 95 * M);
        assertEq(_vested("Marketing"), 70 * M);
        assertEq(_vested("Staking"), 120 * M);
    }

    function test_rewardsPoolYearByYear() public {
        RewardsPool pool = tge.rewardsPool();
        address p2e = makeAddr("p2e");
        // Acumulado ao fim de cada ano: 123 + 102,5 + 82 + 61,5 + 41 milhões.
        uint256[5] memory cumulative =
            [uint256(123 * M), 225.5 ether * 1_000_000, 307.5 ether * 1_000_000, 369 * M, 410 * M];
        for (uint256 y; y < 5; ++y) {
            vm.warp(t0 + y * 365 days);
            pool.release();
            assertEq(scity.balanceOf(p2e), cumulative[y]);
            vm.expectRevert(RewardsPool.NothingToRelease.selector);
            pool.release();
            // Um dia antes da próxima parcela, nada novo.
            vm.warp(t0 + (y + 1) * 365 days - 1 days);
            if (y < 4) assertEq(pool.releasable(), 0);
        }
        vm.warp(t0 + 20 * 365 days);
        assertEq(pool.vestedAmount(uint64(block.timestamp)), 410 * M);
        assertEq(pool.tranches().length, 5);
    }

    function test_vestingWalletReleasesToBeneficiary() public {
        TgeDistributor.Grant memory g = _grant("Team");
        vm.warp(t0 + 24 * MONTH);
        VestingWallet(payable(g.vesting)).release(address(scity));
        assertEq(scity.balanceOf(g.beneficiary), 47.5 ether * 1_000_000);
        assertEq(VestingWallet(payable(g.vesting)).owner(), g.beneficiary);
    }

    function test_distributorRejectsBadConfig() public {
        (TgeDistributor.Allocation[] memory allocs, TgeDistributor.Rewards memory rewards) =
            script.loadConfig(vm.readFile("deploy/tge.example.json"));
        rewards.beneficiary = makeAddr("p2e");
        for (uint256 i; i < allocs.length; ++i) {
            allocs[i].beneficiary = makeAddr(string(abi.encodePacked(allocs[i].name)));
        }
        // Soma diferente de 1 bi.
        allocs[0].amount -= 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                TgeDistributor.SupplyMismatch.selector, 1_000_000_000 ether - 1, 1_000_000_000 ether
            )
        );
        new TgeDistributor(allocs, rewards);
        allocs[0].amount += 1;
        // Tudo direto exige tgeBps = 10.000.
        allocs[4].tgeBps = 5000;
        vm.expectRevert(abi.encodeWithSelector(TgeDistributor.BadAllocation.selector, allocs[4].name));
        new TgeDistributor(allocs, rewards);
        allocs[4].tgeBps = 10_000;
        allocs[1].beneficiary = address(0);
        vm.expectRevert(TgeDistributor.ZeroAddress.selector);
        new TgeDistributor(allocs, rewards);
        allocs[1].beneficiary = makeAddr("x");
        rewards.beneficiary = address(0);
        vm.expectRevert(TgeDistributor.ZeroAddress.selector);
        new TgeDistributor(allocs, rewards);
        // O deployer não recebe nada.
        rewards.beneficiary = address(script);
        vm.expectRevert(bytes("DeployTGE: o deployer nao recebe tokens"));
        script.deploy(allocs, rewards, address(script));
        rewards.beneficiary = makeAddr("p2e");
        allocs[2].beneficiary = address(script);
        vm.expectRevert(bytes("DeployTGE: o deployer nao recebe tokens"));
        script.deploy(allocs, rewards, address(script));
    }

    function test_rewardsPoolRejectsBadSchedule() public {
        uint16[] memory bad = new uint16[](2);
        bad[0] = 5000;
        bad[1] = 4999;
        vm.expectRevert(RewardsPool.BadSchedule.selector);
        new RewardsPool(scity, address(1), 0, 365 days, bad);
        bad[1] = 5000;
        vm.expectRevert(RewardsPool.BadSchedule.selector);
        new RewardsPool(scity, address(1), 0, 0, bad);
        vm.expectRevert(RewardsPool.BadSchedule.selector);
        new RewardsPool(scity, address(1), 0, 365 days, new uint16[](0));
        vm.expectRevert(RewardsPool.ZeroAddress.selector);
        new RewardsPool(scity, address(0), 0, 365 days, bad);
        RewardsPool later = new RewardsPool(scity, address(1), uint64(block.timestamp + 1), 365 days, bad);
        assertEq(later.vestedAmount(uint64(block.timestamp)), 0);
    }

    function test_onlyBscAndConfirmedMainnet() public {
        vm.chainId(31_337);
        vm.expectRevert(bytes("DeployTGE: so na BSC (56) ou na testnet (97)"));
        script.run();
        vm.chainId(56);
        vm.setEnv("CONFIRM_MAINNET", "");
        vm.expectRevert(bytes("DeployTGE: defina CONFIRM_MAINNET=sim"));
        script.lockLiquidity();
    }

    // ---------------------------------------------------------------- TokenLock (LP)

    function test_lpLockRejectsShortLockAndZero() public {
        IERC20 lp = IERC20(address(scity));
        address safe = who["Liquidez (pool)"];
        vm.expectRevert(TokenLock.LockTooShort.selector);
        new TokenLock(lp, safe, uint64(block.timestamp + 364 days));
        vm.expectRevert(TokenLock.ZeroAddress.selector);
        new TokenLock(lp, address(0), uint64(block.timestamp + 365 days));
    }

    function test_lpLockAtLeastTwelveMonths() public {
        IERC20 lp = IERC20(address(scity)); // qualquer ERC-20 serve de LP aqui
        address safe = who["Liquidez (pool)"];
        TokenLock lock = new TokenLock(lp, safe, uint64(block.timestamp + 365 days));
        vm.prank(safe);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        lp.transfer(address(lock), 10 * M);

        uint64 current = lock.releaseTime();
        vm.warp(current - 1 days);
        vm.expectRevert(abi.encodeWithSelector(TokenLock.StillLocked.selector, current));
        lock.release();

        // Só o beneficiário estende, e só para mais longe.
        vm.expectRevert(TokenLock.NotBeneficiary.selector);
        lock.extend(current + 30 days);
        vm.prank(safe);
        vm.expectRevert(TokenLock.LockTooShort.selector);
        lock.extend(current - 1);
        vm.prank(safe);
        lock.extend(current + 30 days);

        vm.warp(current + 1);
        vm.expectRevert(abi.encodeWithSelector(TokenLock.StillLocked.selector, current + 30 days));
        lock.release();
        vm.warp(current + 30 days);
        uint256 before = lp.balanceOf(safe);
        lock.release(); // qualquer um chama; o LP só vai ao beneficiário
        assertEq(lp.balanceOf(safe) - before, 10 * M);
        vm.expectRevert(TokenLock.NothingToRelease.selector);
        lock.release();
    }

    function test_lockLiquidityScript() public {
        address safe = who["Liquidez (pool)"];
        vm.setEnv("LP_TOKEN", vm.toString(address(scity)));
        vm.setEnv("LP_BENEFICIARY", vm.toString(safe));
        vm.setEnv("LP_LOCK_DAYS", "400");
        TokenLock lock = script.lockLiquidity();
        assertEq(lock.beneficiary(), safe);
        assertEq(lock.releaseTime(), block.timestamp + 401 days); // 400 + 1 dia de folga
        vm.removeFile("deployments/97-lp-lock.json");
    }
}
