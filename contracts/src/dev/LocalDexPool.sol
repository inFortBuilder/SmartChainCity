// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Dólar de teste **só para a rede local (anvil)**: faz o papel do USDT da BSC (18 casas) no par da DEX.
contract LocalUSD is ERC20 {
    constructor(address recipient) ERC20("Local USD", "lUSD") {
        _mint(recipient, 1_000_000_000 ether);
    }
}

/// @notice Pool **só para a rede local (anvil) e os testes**, com o mesmo oráculo de preço do pool da
/// PancakeSwap V3 (e da Uniswap V3): `token0`, `token1` e `observe`. Não troca tokens: o preço é o `tick`
/// que qualquer um define, e o `observe` devolve o tick acumulado no tempo, como o pool real. O economy lê
/// a média de 24 h (TWAP) desse acumulado. Na BSC, o economy lê o pool SCITY/USDT real.
contract LocalDexPool {
    struct Observation {
        uint32 time;
        int56 tickCumulative;
        int24 tick; // tick em vigor a partir de `time`
    }

    address public immutable token0;
    address public immutable token1;
    Observation[] public observations;

    event TickSet(int24 tick);

    /// @param tick_ preço inicial: 1,0001^tick unidades de `token1` por unidade de `token0`.
    constructor(address tokenA, address tokenB, int24 tick_) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        // forge-lint: disable-next-line(unsafe-typecast) — o tempo em uint32, como no pool real
        observations.push(Observation(uint32(block.timestamp), 0, tick_));
        emit TickSet(tick_);
    }

    /// @notice Muda o preço a partir de agora (o papel das trocas no pool real).
    function setTick(int24 tick_) external {
        Observation memory last = observations[observations.length - 1];
        // forge-lint: disable-next-line(unsafe-typecast) — o tempo em uint32, como no pool real
        uint32 nowTs = uint32(block.timestamp);
        int56 cumulative = last.tickCumulative + int56(last.tick) * int56(uint56(nowTs - last.time));
        if (last.time == nowTs) observations[observations.length - 1].tick = tick_;
        else observations.push(Observation(nowTs, cumulative, tick_));
        emit TickSet(tick_);
    }

    /// @notice Tick acumulado `secondsAgos[i]` segundos atrás. Reverte com "OLD" antes da primeira
    /// observação, como o pool real quando falta histórico.
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast) — o tempo em uint32, como no pool real
            tickCumulatives[i] = _cumulativeAt(uint32(block.timestamp) - secondsAgos[i]);
        }
    }

    function _cumulativeAt(uint32 target) internal view returns (int56) {
        // forge-lint: disable-next-line(require-revert-in-loop) — o mesmo "OLD" do pool real
        require(target >= observations[0].time, "OLD");
        uint256 i = observations.length - 1;
        while (observations[i].time > target) i--;
        Observation memory o = observations[i];
        return o.tickCumulative + int56(o.tick) * int56(uint56(target - o.time));
    }
}
