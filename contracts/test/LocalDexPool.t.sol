// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {LocalDexPool} from "../src/dev/LocalDexPool.sol";

contract LocalDexPoolTest is Test {
    LocalDexPool pool;
    uint256 t0;

    function setUp() public {
        t0 = block.timestamp;
        pool = new LocalDexPool(address(0xBEEF), address(0xCAFE), 100);
    }

    function _observe(uint32 ago) internal view returns (int56) {
        uint32[] memory a = new uint32[](1);
        a[0] = ago;
        (int56[] memory c,) = pool.observe(a);
        return c[0];
    }

    function test_OrdenaOsTokensComoOPoolReal() public {
        LocalDexPool p = new LocalDexPool(address(0xCAFE), address(0xBEEF), 0);
        assertEq(p.token0(), address(0xBEEF));
        assertEq(p.token1(), address(0xCAFE));
    }

    function test_AcumulaOTickNoTempoEInterpola() public {
        vm.warp(t0 + 1000);
        pool.setTick(-50);
        vm.warp(t0 + 3000);
        // Agora: 100 por 1000 s + (-50) por 2000 s.
        assertEq(_observe(0), 100 * 1000 - 50 * 2000);
        // 2500 s atrás = t0 + 500: só o primeiro tick.
        assertEq(_observe(2500), 100 * 500);
        // Média dos últimos 3000 s.
        assertEq((_observe(0) - _observe(3000)) / 3000, 0);
    }

    function test_DoisTicksNoMesmoSegundoFicaOUltimo() public {
        vm.warp(t0 + 10);
        pool.setTick(7);
        pool.setTick(9);
        vm.warp(t0 + 20);
        assertEq(_observe(0), 100 * 10 + 9 * 10);
    }

    function test_SemHistoricoRevertePeloOld() public {
        vm.warp(t0 + 60);
        vm.expectRevert(bytes("OLD"));
        this.observeOne(61);
    }

    function observeOne(uint32 ago) external view returns (int56) {
        return _observe(ago);
    }
}
