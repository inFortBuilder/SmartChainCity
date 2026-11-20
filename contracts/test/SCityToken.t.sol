// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {SCityToken} from "../src/SCityToken.sol";

/// Faz transferências e aprovações aleatórias para o teste de invariante.
contract TokenHandler is Test {
    SCityToken public token;
    address[] public actors;

    constructor(SCityToken token_, address[] memory actors_) {
        token = token_;
        actors = actors_;
    }

    function transfer(uint256 from, uint256 to, uint256 amount) external {
        address a = actors[from % actors.length];
        address b = actors[to % actors.length];
        amount = bound(amount, 0, token.balanceOf(a));
        vm.prank(a);
        token.transfer(b, amount);
    }

    function approveAndPull(uint256 owner, uint256 spender, uint256 amount) external {
        address o = actors[owner % actors.length];
        address s = actors[spender % actors.length];
        amount = bound(amount, 0, token.balanceOf(o));
        vm.prank(o);
        token.approve(s, amount);
        vm.prank(s);
        token.transferFrom(o, s, amount);
    }
}

contract SCityTokenTest is Test {
    SCityToken token;
    TokenHandler handler;
    address distributor = makeAddr("distribuicao");

    function setUp() public {
        token = new SCityToken(distributor);
        address[] memory actors = new address[](4);
        actors[0] = distributor;
        actors[1] = makeAddr("a");
        actors[2] = makeAddr("b");
        actors[3] = makeAddr("c");
        handler = new TokenHandler(token, actors);
        targetContract(address(handler));
    }

    function test_fixedSupplyMintedOnce() public view {
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(distributor), 1_000_000_000 ether);
        assertEq(token.symbol(), "SCITY");
        assertEq(token.decimals(), 18);
    }

    /// Não existe função de mint: o seletor não está no contrato.
    function test_hasNoMintFunction() public {
        (bool ok,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        assertFalse(ok);
    }

    function test_permitSetsAllowance() public {
        (address owner, uint256 key) = makeAddrAndKey("dono");
        vm.prank(distributor);
        token.transfer(owner, 100 ether);
        address spender = makeAddr("gasto");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                owner,
                spender,
                100 ether,
                token.nonces(owner),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        token.permit(owner, spender, 100 ether, deadline, v, r, s);
        assertEq(token.allowance(owner, spender), 100 ether);
    }

    /// Trilha de contratos, passo 6: `totalSupply` constante.
    function invariant_totalSupplyIsConstant() public view {
        assertEq(token.totalSupply(), token.TOTAL_SUPPLY());
    }
}
