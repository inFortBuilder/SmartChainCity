// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title SCITY
/// @notice Token BEP-20 de oferta fixa (doc 07 §1, doc 04 §2). A oferta inteira é criada uma única vez
/// no deploy, para o contrato de distribuição. Não há função de mint posterior nem dono.
contract SCityToken is ERC20, ERC20Permit {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    constructor(address recipient) ERC20("Smart Chain City", "SCITY") ERC20Permit("Smart Chain City") {
        _mint(recipient, TOTAL_SUPPLY);
    }
}
