// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

import {SCityToken} from "../SCityToken.sol";
import {RewardsPool} from "./RewardsPool.sol";

/// @title TgeDistributor
/// @notice O TGE numa transação só (doc 04 §2): cria o SCITY com a oferta inteira para si e distribui tudo no
/// próprio construtor. Ninguém segura o suprimento no meio do caminho e o contrato termina com saldo zero.
/// - Cada alocação manda `tgeBps` direto ao beneficiário e o resto a uma `VestingWallet` da OZ, que libera em
///   linha reta de `TGE + cliff` até `TGE + cliff + duration`. Com `duration` zero, vai tudo direto.
/// - O Play-to-Earn vai ao `RewardsPool`, com as parcelas anuais.
/// Fica como registro público: `grants` lista cada alocação, com o beneficiário e a carteira de vesting.
contract TgeDistributor {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    struct Allocation {
        bytes32 name;
        address beneficiary;
        uint256 amount;
        uint16 tgeBps;
        uint64 cliff;
        uint64 duration;
    }

    struct Rewards {
        address beneficiary;
        uint256 amount;
        uint64 interval;
        uint16[] tranches;
    }

    struct Grant {
        bytes32 name;
        address beneficiary;
        address vesting;
        uint256 atTge;
        uint256 vested;
    }

    SCityToken public immutable token;
    RewardsPool public immutable rewardsPool;
    uint64 public immutable tge;
    Grant[] private _grants;

    event Granted(
        bytes32 indexed name, address indexed beneficiary, address vesting, uint256 atTge, uint256 vested
    );

    error ZeroAddress();
    error BadAllocation(bytes32 name);
    error SupplyMismatch(uint256 allocated, uint256 supply);

    constructor(Allocation[] memory allocations, Rewards memory rewards) {
        // forge-lint: disable-next-line(unsafe-typecast)
        tge = uint64(block.timestamp);
        SCityToken scity = new SCityToken(address(this));
        token = scity;
        uint256 supply = scity.TOTAL_SUPPLY();
        uint256 total = rewards.amount;
        for (uint256 i; i < allocations.length; ++i) {
            total += allocations[i].amount;
        }
        if (total != supply) revert SupplyMismatch(total, supply);
        if (rewards.beneficiary == address(0)) revert ZeroAddress();

        RewardsPool pool =
            new RewardsPool(scity, rewards.beneficiary, tge, rewards.interval, rewards.tranches);
        rewardsPool = pool;
        _grants.push(Grant("Play-to-Earn", rewards.beneficiary, address(pool), 0, rewards.amount));
        emit Granted("Play-to-Earn", rewards.beneficiary, address(pool), 0, rewards.amount);
        IERC20(scity).safeTransfer(address(pool), rewards.amount);

        for (uint256 i; i < allocations.length; ++i) {
            _allocate(scity, allocations[i]);
        }
    }

    function _allocate(IERC20 scity, Allocation memory a) internal {
        if (a.beneficiary == address(0)) revert ZeroAddress();
        if (a.amount == 0 || a.tgeBps > BPS || (a.duration == 0 && a.tgeBps != BPS)) {
            revert BadAllocation(a.name);
        }
        uint256 atTge = a.amount * a.tgeBps / BPS;
        uint256 vested = a.amount - atTge;
        address wallet =
            vested > 0 ? address(new VestingWallet(a.beneficiary, tge + a.cliff, a.duration)) : address(0);
        _grants.push(Grant(a.name, a.beneficiary, wallet, atTge, vested));
        emit Granted(a.name, a.beneficiary, wallet, atTge, vested);
        if (vested > 0) scity.safeTransfer(wallet, vested);
        if (atTge > 0) scity.safeTransfer(a.beneficiary, atTge);
    }

    function grants() external view returns (Grant[] memory) {
        return _grants;
    }
}
