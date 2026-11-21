import type { WorldStore } from './lots.js';
import type { PropertyStore } from './properties.js';
import type { SeizureStore } from './seizures.js';

/**
 * Posse on-chain → jogo (doc 07 §2.1 e §2.2). O `LandNFT` e o `PropertyNFT`
 * circulam livres (ADR-0014): uma venda fora do jogo muda o dono do token. O
 * job `chain.sync` lê o feed de eventos confirmados do chain-indexer e passa o
 * lote ou o imóvel para a conta dona da carteira que recebeu.
 *
 * - Só transferências (`from` diferente de zero): o mint é o próprio jogo
 *   levando o que já era do jogador para a carteira.
 * - Carteira sem conta: a transferência fica pendente e sai quando a carteira
 *   for ligada. Até lá, o jogo mantém o dono antigo.
 * - Transferências seguidas do mesmo token: vale a última.
 * - Repetir não muda nada: cada passagem só acontece se o dono ainda for o de
 *   antes, e o cursor do feed só anda depois de tudo gravado.
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

export interface PendingTransfer {
  eventId: number;
  kind: 'lot' | 'property';
  tokenId: string;
  to: string;
}

export interface ChainSyncStore {
  cursor(): Promise<number>;
  setCursor(after: number): Promise<void>;
  addPending(t: PendingTransfer): Promise<void>;
  pending(limit: number): Promise<PendingTransfer[]>;
  dropPending(eventId: number): Promise<void>;
  /** Uma transferência nova do mesmo token vence as pendentes dele. */
  dropPendingFor(kind: PendingTransfer['kind'], tokenId: string): Promise<void>;
}

const ZERO = '0x0000000000000000000000000000000000000000';

/** O `tokenId` do LandNFT é cidade << 32 | lote. */
export const lotOfToken = (tokenId: bigint) => ({ city: Number(tokenId >> 32n), lot: Number(tokenId & 0xffffffffn) });

/** O `tokenId` do PropertyNFT é o UUID do imóvel (128 bits). */
export function propertyIdOfToken(tokenId: bigint): string | null {
  if (tokenId <= 0n || tokenId >= 1n << 128n) return null;
  const h = tokenId.toString(16).padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface Deps {
  feed: ChainFeed;
  owners: WalletOwners;
  store: ChainSyncStore;
  lots: WorldStore;
  properties: PropertyStore;
  /** Código da cidade no world para o id numérico do contrato (inverso de LAND_CITY_IDS). */
  cityOf: (cityNftId: number) => string | undefined;
  /** Apreensões do leilão (ADR-0016): enquanto aberta, o token só muda de dono no jogo pela apreensão. */
  seizures?: SeizureStore | null;
  now?: () => Date;
}

/** Passa o token ao dono da carteira. true se terminou (aplicado ou nada a fazer); false se a carteira não tem conta. */
async function apply(deps: Deps, t: PendingTransfer): Promise<boolean> {
  // Leilão com apreensão aberta: o jogo já deu o token ao vencedor. Chegou a ele, a apreensão fecha;
  // qualquer outra transferência (o dono antigo vendendo) não muda o dono no jogo.
  const seized = await deps.seizures?.openFor(t.kind, t.tokenId);
  if (seized) {
    const to = await deps.owners.ownerOf(t.to);
    if (to === seized.toAccountId) await deps.seizures!.close(seized.id, 'done', deps.now?.() ?? new Date());
    return true;
  }
  const accountId = await deps.owners.ownerOf(t.to);
  if (!accountId) return false;
  const tokenId = BigInt(t.tokenId);
  if (t.kind === 'lot') {
    const { city: cityId, lot: lotId } = lotOfToken(tokenId);
    const city = deps.cityOf(cityId);
    if (!city) return true; // cidade que o world não conhece: nada a fazer
    const lot = await deps.lots.getLot(city, lotId);
    if (!lot?.ownerAccountId || lot.ownerAccountId === accountId) return true;
    await deps.lots.transferLot(city, lotId, lot.ownerAccountId, accountId);
    return true;
  }
  const id = propertyIdOfToken(tokenId);
  const property = id ? await deps.properties.getProperty(id) : null;
  if (!property || property.ownerAccountId === accountId) return true;
  await deps.properties.transferProperty(property.id, property.ownerAccountId, accountId);
  return true;
}

export async function syncChain(deps: Deps, batch = 200) {
  const r = { applied: 0, pending: 0 };
  // Primeiro as pendentes: a carteira pode ter sido ligada desde a última rodada.
  for (const t of await deps.store.pending(batch)) {
    if (await apply(deps, t)) {
      await deps.store.dropPending(t.eventId);
      r.applied++;
    } else r.pending++;
  }
  for (;;) {
    const after = await deps.store.cursor();
    const { events, nextAfter } = await deps.feed.events(after, batch);
    for (const e of events) {
      if (e.event !== 'Transfer' || (e.contract !== 'LandNFT' && e.contract !== 'PropertyNFT')) continue;
      const from = String(e.args.from).toLowerCase();
      const to = String(e.args.to).toLowerCase();
      if (from === ZERO || to === ZERO) continue;
      const t: PendingTransfer = { eventId: e.id, kind: e.contract === 'LandNFT' ? 'lot' : 'property', tokenId: String(e.args.tokenId), to };
      await deps.store.dropPendingFor(t.kind, t.tokenId);
      if (await apply(deps, t)) r.applied++;
      else {
        await deps.store.addPending(t);
        r.pending++;
      }
    }
    if (nextAfter !== after) await deps.store.setCursor(nextAfter);
    if (events.length < batch) return r;
  }
}

/** Regra do doc 07 §2.2: o imóvel só rende se o dono dele também for o dono do lote. */
export const rentsHere = (lotOwner: string | null | undefined, propertyOwner: string) => lotOwner === propertyOwner;
