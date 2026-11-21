import { type Address, createPublicClient, http, parseAbi } from 'viem';

import type { DexPool, PoolTokens, TickSample } from '../domain/fx-twap.js';

const poolAbi = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)',
]);
const erc20Abi = parseAbi(['function decimals() view returns (uint8)']);

/** Pool da PancakeSwap V3 (ou Uniswap V3, ou o `LocalDexPool` do anvil) pela RPC. */
export class RpcDexPool implements DexPool {
  private readonly client;
  private cached: PoolTokens | null = null;
  /** Bloco da última leitura de `current`, para `cumulativeAgo` ler no mesmo bloco. */
  private readonly blocks = new Map<number, bigint>();

  constructor(
    rpcUrl: string,
    private readonly address: Address,
  ) {
    this.client = createPublicClient({ transport: http(rpcUrl) });
  }

  async tokens(): Promise<PoolTokens> {
    if (this.cached) return this.cached;
    const [token0, token1] = await Promise.all([
      this.client.readContract({ address: this.address, abi: poolAbi, functionName: 'token0' }),
      this.client.readContract({ address: this.address, abi: poolAbi, functionName: 'token1' }),
    ]);
    const [decimals0, decimals1] = await Promise.all([
      this.client.readContract({ address: token0, abi: erc20Abi, functionName: 'decimals' }),
      this.client.readContract({ address: token1, abi: erc20Abi, functionName: 'decimals' }),
    ]);
    this.cached = { token0, token1, decimals0, decimals1 };
    return this.cached;
  }

  async current(): Promise<TickSample> {
    const block = await this.client.getBlock();
    const [cumulatives] = await this.client.readContract({ address: this.address, abi: poolAbi, functionName: 'observe', args: [[0]], blockNumber: block.number });
    const at = new Date(Number(block.timestamp) * 1000);
    this.blocks.clear();
    this.blocks.set(at.getTime(), block.number);
    return { at, tickCumulative: BigInt(cumulatives[0]!) };
  }

  async cumulativeAgo(secondsAgo: number, current: TickSample): Promise<bigint> {
    const blockNumber = this.blocks.get(current.at.getTime());
    const [cumulatives] = await this.client.readContract({ address: this.address, abi: poolAbi, functionName: 'observe', args: [[secondsAgo]], blockNumber });
    return BigInt(cumulatives[0]!);
  }
}
