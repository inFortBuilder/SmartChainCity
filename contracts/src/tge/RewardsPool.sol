// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RewardsPool
/// @notice Guarda o pool Play-to-Earn e libera por parcelas (doc 04 §3: 30%, 25%, 20%, 15% e 10% ao ano).
/// A parcela `i` destrava em `start + i * interval`; a primeira, já no `start`. Cronograma e beneficiário são
/// imutáveis: ninguém acelera nem desvia a emissão. Qualquer um chama `release`, que só paga ao beneficiário.
contract RewardsPool {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint64 public immutable start;
    uint64 public immutable interval;
    uint16[] private _tranches;
    uint256 public released;

    event Released(address indexed beneficiary, uint256 amount);

    error ZeroAddress();
    error BadSchedule();
    error NothingToRelease();

    constructor(
        IERC20 token_,
        address beneficiary_,
        uint64 start_,
        uint64 interval_,
        uint16[] memory tranches_
    ) {
        if (address(token_) == address(0) || beneficiary_ == address(0)) {
            revert ZeroAddress();
        }
        if (interval_ == 0 || tranches_.length == 0) revert BadSchedule();
        uint256 sum = 0;
        for (uint256 i; i < tranches_.length; ++i) {
            sum += tranches_[i];
        }
        if (sum != BPS) revert BadSchedule();
        token = token_;
        beneficiary = beneficiary_;
        start = start_;
        interval = interval_;
        _tranches = tranches_;
    }

    function tranches() external view returns (uint16[] memory) {
        return _tranches;
    }

    /// @notice Quanto do pool (saldo + já liberado) está destravado no instante `t`.
    function vestedAmount(uint64 t) public view returns (uint256) {
        if (t < start) return 0;
        uint256 total = token.balanceOf(address(this)) + released;
        uint256 open = (t - start) / interval + 1;
        if (open >= _tranches.length) return total;
        uint256 bps = 0;
        for (uint256 i; i < open; ++i) {
            bps += _tranches[i];
        }
        return total * bps / BPS;
    }

    function releasable() public view returns (uint256) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return vestedAmount(uint64(block.timestamp)) - released;
    }

    function release() external {
        uint256 amount = releasable();
        // Zero só barra a liberação vazia (UX); o saldo não decide prazo nem permissão.
        // slither-disable-next-line incorrect-equality
        if (amount == 0) revert NothingToRelease();
        released += amount;
        emit Released(beneficiary, amount);
        token.safeTransfer(beneficiary, amount);
    }
}
