// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Cobrança das vendas primárias: moeda nativa (BNB, `currency == address(0)`) ou um token ERC-20
/// (SCITY, stablecoin). O valor vai direto para a tesouraria; o contrato não guarda saldo.
library Payment {
    using SafeERC20 for IERC20;

    error WrongValue(uint256 expected, uint256 sent);
    error NativeTransferFailed();

    function collect(address currency, uint256 price, address payer, address treasury) internal {
        if (currency == address(0)) {
            if (msg.value != price) revert WrongValue(price, msg.value);
            if (price == 0) return;
            (bool ok,) = treasury.call{value: price}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            if (msg.value != 0) revert WrongValue(0, msg.value);
            if (price == 0) return;
            IERC20(currency).safeTransferFrom(payer, treasury, price);
        }
    }
}
