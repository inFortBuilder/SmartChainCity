import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import { type AvatarStore, newAvatar } from './avatar.js';
import { RARITIES } from './catalog.js';

/**
 * AvatarNFT → jogo (doc 07 §2, ADR-0014). O job `chain.sync` lê o feed de
 * eventos confirmados do chain-indexer:
 *
 * - `AvatarMinted` (a Lucky Box revelou o avatar): cria o avatar no jogo, com a
 *   raridade e a profissão gravadas no token, para a conta dona da carteira.
 * - `Transfer` entre carteiras (venda fora do jogo): passa o avatar para a
 *   conta da carteira que recebeu.
 *
 * Carteira sem conta: fica pendente, uma por token, e sai quando a carteira
 * for ligada. Se o token muda de mão antes disso, vale a última carteira
 * (inclusive para um mint ainda pendente). Repetir não muda nada: o avatar é
 * criado uma vez por token, a passagem só acontece se o dono ainda for o de
 * antes, e o cursor do feed só anda depois de tudo gravado.
 */
export interface FeedEvent {
  id: number;
  contract: string;
  event: string;
  args: Record<string, string | number | boolean>;
}

export interface ChainFeed {
  events(after: number, limit: number): Promise<{ events: FeedEvent[]; nextAfter: number }>;
}

export interface WalletOwners {
  ownerOf(address: string): Promise<string | null>;
}

export interface PendingAvatar {
  tokenId: string;
  eventId: number;
  /** Carteira que tem o token agora. */
  to: string;
  /** Só no mint ainda não aplicado: o que vai para o avatar novo. */
  mint: { rarity: number; profession: string } | null;
}

export interface ChainSyncStore {
  cursor(): Promise<number>;
  setCursor(after: number): Promise<void>;
  /** Grava ou troca a pendente do token. */
  putPending(p: PendingAvatar): Promise<void>;
  getPending(tokenId: string): Promise<PendingAvatar | null>;
  pending(limit: number): Promise<PendingAvatar[]>;
  dropPending(tokenId: string): Promise<void>;
}

const ZERO = '0x0000000000000000000000000000000000000000';

/** `bytes32` da profissão ("padeiro"), com zeros à direita → texto. */
export const professionText = (hex: string) =>
  Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('utf8').replace(/\0+$/, '');

interface Deps {
  feed: ChainFeed;
  owners: WalletOwners;
  store: ChainSyncStore;
  avatars: AvatarStore;
  now: () => Date;
}

type Outcome = 'created' | 'transferred' | 'nothing' | 'pending' | 'rejected';

/** Leva o token à conta da carteira. */
async function apply(deps: Deps, p: PendingAvatar): Promise<Outcome> {
  const accountId = await deps.owners.ownerOf(p.to);
  if (!accountId) return 'pending';
  const current = await deps.avatars.getByToken(p.tokenId);
  if (current) {
    if (current.accountId === accountId) return 'nothing';
    return (await deps.avatars.transfer(current.id, current.accountId, accountId, deps.now())) ? 'transferred' : 'nothing';
  }
  if (!p.mint) return 'nothing'; // token que o jogo não conhece e sem mint visto: nada a criar
  const rarity = RARITIES[p.mint.rarity];
  try {
    const avatar = newAvatar(
      { id: randomUUID(), tokenId: p.tokenId, accountId, rarity: rarity ?? String(p.mint.rarity), jobCode: p.mint.profession },
      deps.now(),
    );
    await deps.avatars.createFromChain({ ...avatar, tokenId: p.tokenId });
    return 'created';
  } catch (error) {
    // Raridade ou profissão fora do catálogo: fica pendente até o catálogo ter a profissão.
    if (error instanceof AppError && (error.code === 'invalid_rarity' || error.code === 'invalid_job')) return 'rejected';
    throw error;
  }
}

export async function syncChain(deps: Deps, batch = 200) {
  const r = { created: 0, transferred: 0, pending: 0, rejected: 0 };
  const count = (o: Outcome) => {
    if (o === 'created') r.created++;
    else if (o === 'transferred') r.transferred++;
    else if (o === 'pending') r.pending++;
    else if (o === 'rejected') r.rejected++;
  };
  const settle = async (p: PendingAvatar) => {
    const o = await apply(deps, p);
    if (o === 'pending' || o === 'rejected') await deps.store.putPending(p);
    else await deps.store.dropPending(p.tokenId);
    count(o);
  };

  // Primeiro as pendentes: a carteira pode ter sido ligada desde a última rodada.
  for (const p of await deps.store.pending(batch)) await settle(p);

  for (;;) {
    const after = await deps.store.cursor();
    const { events, nextAfter } = await deps.feed.events(after, batch);
    for (const e of events) {
      if (e.contract !== 'AvatarNFT') continue;
      const tokenId = String(e.args.tokenId);
      if (e.event === 'AvatarMinted') {
        await settle({
          tokenId,
          eventId: e.id,
          to: String(e.args.to).toLowerCase(),
          mint: { rarity: Number(e.args.rarity), profession: professionText(String(e.args.profession)) },
        });
      } else if (e.event === 'Transfer') {
        const from = String(e.args.from).toLowerCase();
        const to = String(e.args.to).toLowerCase();
        if (from === ZERO || to === ZERO) continue; // o mint vem pelo AvatarMinted
        // Um mint ainda pendente segue para a carteira nova.
        const before = await deps.store.getPending(tokenId);
        await settle({ tokenId, eventId: e.id, to, mint: before?.mint ?? null });
      }
    }
    if (nextAfter !== after) await deps.store.setCursor(nextAfter);
    if (events.length < batch) return r;
  }
}
