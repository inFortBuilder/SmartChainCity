import type { Hex } from 'viem';

import {
  type AvatarToken,
  type BoxRequest,
  type ChainEvent,
  type Cursor,
  type LotToken,
  type PropertyToken,
  byChainOrder,
} from './events.js';

/**
 * Leitura da rede com confirmações (doc 05 §4, trilha-backend passo 13):
 * - só lê blocos com pelo menos `confirmations` blocos em cima;
 * - cada evento entra uma vez (`tx_hash + log_index`), mesmo se a faixa for relida;
 * - eventos, projeções e cursor gravam juntos, numa transação;
 * - se o bloco do cursor mudou de hash (reorganização mais funda que as
 *   confirmações), volta `reorgDepth` blocos, apaga o que veio depois e
 *   reconstrói as projeções a partir dos eventos que sobraram.
 */

export interface ChainReader {
  head(): Promise<bigint>;
  blockHash(block: bigint): Promise<Hex | null>;
  /** Eventos dos contratos configurados na faixa (inclusive), já decodificados. */
  logs(from: bigint, to: bigint): Promise<ChainEvent[]>;
}

export interface IndexerStore {
  cursor(chainId: number): Promise<Cursor | null>;
  /** Grava os eventos novos, aplica as projeções e avança o cursor. Devolve quantos eram novos. */
  commit(chainId: number, events: ChainEvent[], cursor: Cursor): Promise<number>;
  /** Apaga eventos depois de `cursor.block`, refaz as projeções e põe o cursor ali. */
  rewind(chainId: number, cursor: Cursor | null): Promise<number>;
  lot(chainId: number, tokenId: string): Promise<LotToken | null>;
  lotsOf(chainId: number, owner: string): Promise<LotToken[]>;
  avatar(chainId: number, tokenId: string): Promise<AvatarToken | null>;
  avatarsOf(chainId: number, owner: string): Promise<AvatarToken[]>;
  property(chainId: number, tokenId: string): Promise<PropertyToken | null>;
  propertiesOf(chainId: number, owner: string): Promise<PropertyToken[]>;
  box(chainId: number, requestId: string): Promise<BoxRequest | null>;
  /** Eventos em ordem de gravação, depois de `afterId` (feed para os outros serviços). */
  eventsAfter(chainId: number, afterId: number, limit: number): Promise<(ChainEvent & { id: number })[]>;
}

export interface IndexerOptions {
  chainId: number;
  confirmations: number;
  /** Primeiro bloco a ler (o do deploy dos contratos). */
  startBlock: bigint;
  batchBlocks: number;
  reorgDepth: number;
}

export type TickResult =
  | { kind: 'idle'; head: bigint; cursor: bigint | null }
  | { kind: 'indexed'; from: bigint; to: bigint; events: number; inserted: number }
  | { kind: 'reorg'; rewoundTo: bigint | null; dropped: number };

export async function tick(reader: ChainReader, store: IndexerStore, opt: IndexerOptions): Promise<TickResult> {
  const cursor = await store.cursor(opt.chainId);

  // Reorganização: o bloco que já lemos não é mais o mesmo.
  if (cursor) {
    const hash = await reader.blockHash(cursor.block);
    if (hash !== cursor.hash) {
      const target = cursor.block - BigInt(opt.reorgDepth);
      let back: Cursor | null = null;
      if (target >= opt.startBlock) {
        const h = await reader.blockHash(target);
        if (h) back = { block: target, hash: h };
      }
      const dropped = await store.rewind(opt.chainId, back);
      return { kind: 'reorg', rewoundTo: back?.block ?? null, dropped };
    }
  }

  const head = await reader.head();
  const safe = head - BigInt(opt.confirmations);
  const from = cursor ? cursor.block + 1n : opt.startBlock;
  if (from > safe) return { kind: 'idle', head, cursor: cursor?.block ?? null };
  const max = from + BigInt(opt.batchBlocks) - 1n;
  const to = safe < max ? safe : max;

  const events = (await reader.logs(from, to)).filter((e) => e.blockNumber >= from && e.blockNumber <= to).sort(byChainOrder);
  const hash = await reader.blockHash(to);
  if (!hash) throw new Error(`Bloco ${to} sem hash no RPC.`);
  const inserted = await store.commit(opt.chainId, events, { block: to, hash });
  return { kind: 'indexed', from, to, events: events.length, inserted };
}
