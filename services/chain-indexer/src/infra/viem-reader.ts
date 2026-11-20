import { type Address, type Hex, type PublicClient, createPublicClient, http, parseEventLogs } from 'viem';

import { CONTRACT_ABIS, type ChainEvent, type ContractName, normalizeArgs } from '../domain/events.js';
import type { ChainReader } from '../domain/indexer.js';

/** Lê blocos e eventos por JSON-RPC (anvil, BSC Testnet ou BSC). */
export class ViemChainReader implements ChainReader {
  private readonly client: PublicClient;
  private readonly byAddress: Map<string, ContractName>;

  constructor(
    rpcUrl: string,
    private readonly chainId: number,
    contracts: Partial<Record<ContractName, Address>>,
  ) {
    this.client = createPublicClient({ transport: http(rpcUrl, { timeout: 15_000, retryCount: 2 }) });
    this.byAddress = new Map(
      Object.entries(contracts)
        .filter(([, a]) => a)
        .map(([name, a]) => [(a as string).toLowerCase(), name as ContractName]),
    );
  }

  head() {
    return this.client.getBlockNumber({ cacheTime: 0 });
  }

  async blockHash(block: bigint): Promise<Hex | null> {
    try {
      return (await this.client.getBlock({ blockNumber: block })).hash;
    } catch {
      return null;
    }
  }

  async logs(from: bigint, to: bigint): Promise<ChainEvent[]> {
    if (this.byAddress.size === 0) return [];
    const raw = await this.client.getLogs({ address: [...this.byAddress.keys()] as Address[], fromBlock: from, toBlock: to });
    const out: ChainEvent[] = [];
    for (const [address, contract] of this.byAddress) {
      const mine = raw.filter((l) => l.address.toLowerCase() === address);
      if (mine.length === 0) continue;
      // Eventos de outra ABI (ex.: Approval, RoleGranted) ficam de fora.
      const parsed = parseEventLogs({ abi: CONTRACT_ABIS[contract], logs: mine, strict: true });
      for (const l of parsed) {
        if (l.blockNumber === null || l.blockHash === null || l.transactionHash === null || l.logIndex === null) continue;
        out.push({
          chainId: this.chainId,
          blockNumber: l.blockNumber,
          blockHash: l.blockHash,
          txHash: l.transactionHash,
          logIndex: l.logIndex,
          contract,
          event: l.eventName,
          args: normalizeArgs(l.args as Record<string, unknown>),
        });
      }
    }
    return out;
  }
}
