// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TokenLock
/// @notice Trava um ERC-20 (o LP do pool SCITY na DEX) por **no mínimo 12 meses** (doc 07 §3, doc 04 §2).
/// O prazo só pode ser estendido, nunca encurtado. Depois dele, tudo volta ao beneficiário (o multisig da
/// liquidez). Resposta direta ao *rug pull*: qualquer um confere `releaseTime` e o saldo na cadeia.
contract TokenLock {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_LOCK = 365 days;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint64 public releaseTime;

    event Extended(uint64 releaseTime);
    event Released(address indexed beneficiary, uint256 amount);

    error ZeroAddress();
    error LockTooShort();
    error NotBeneficiary();
    error StillLocked(uint64 releaseTime);
    error NothingToRelease();

    constructor(IERC20 token_, address beneficiary_, uint64 releaseTime_) {
        if (address(token_) == address(0) || beneficiary_ == address(0)) revert ZeroAddress();
        if (releaseTime_ < block.timestamp + MIN_LOCK) revert LockTooShort();
        token = token_;
        beneficiary = beneficiary_;
        releaseTime = releaseTime_;
    }

    /// @notice Só o beneficiário, e só para mais longe.
    function extend(uint64 newReleaseTime) external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (newReleaseTime <= releaseTime) revert LockTooShort();
        releaseTime = newReleaseTime;
        emit Extended(newReleaseTime);
    }

    function release() external {
        if (block.timestamp < releaseTime) revert StillLocked(releaseTime);
        uint256 amount = token.balanceOf(address(this));
        if (amount == 0) revert NothingToRelease();
        emit Released(beneficiary, amount);
        token.safeTransfer(beneficiary, amount);
    }
}
