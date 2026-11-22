import { AppError } from '@scc/shared';

/**
 * Venda de lançamento (E4.3): a abertura de uma região com fila e limite por carteira.
 *
 * - **Fila (sala de espera):** a fila abre `preQueueSeconds` antes da venda. Quem entra antes da abertura
 *   recebe a posição por **sorteio**, para não premiar o bot que chega primeiro; depois da abertura, por
 *   ordem de chegada, atrás de todos os sorteados.
 * - **Lotes de entrada:** a cada `batchSeconds` entram mais `batchSize` posições. A vez de cada um é
 *   calculada da posição, sem job: `max(entrada, abertura + ⌊(posição − 1) / batchSize⌋ · batchSeconds)`.
 *   Quem entra tem `windowSeconds` para comprar. Se a vez passar, volta ao fim da fila.
 * - **Limite:** durante o lançamento, cada conta compra até `maxLots` lotes, contando as compras pagas e as em
 *   andamento desde a abertura. Com `requireWallet`, só entra na fila quem tem carteira ligada, e como uma
 *   carteira só se liga a uma conta (gateway), o limite vale por carteira.
 * - Depois de `endsAt`, a venda volta ao normal: sem fila nem limite, só as regras de sempre (doc 03 §4).
 */
export interface SaleConfig {
  city: string;
  opensAt: Date;
  endsAt: Date;
  preQueueSeconds: number;
  batchSize: number;
  batchSeconds: number;
  windowSeconds: number;
  maxLots: number;
  requireWallet: boolean;
}

export interface QueueTicket {
  id: number;
  city: string;
  accountId: string;
  joinedAt: Date;
  /** Entrou antes da abertura: a posição sai do sorteio. */
  preOpen: boolean;
  /** Posição na fila, a partir de 1 (antes da abertura, provisória). */
  position: number;
}

export interface SaleStore {
  getSale(city: string): Promise<SaleConfig | null>;
  setSale(sale: SaleConfig): Promise<void>;
  clearSale(city: string): Promise<void>;
  /** A ficha mais recente da conta na fila da cidade, com a posição. */
  latestTicket(city: string, accountId: string): Promise<QueueTicket | null>;
  /**
   * Entra na fila. Se a ficha atual ainda vale (`stillValid`), devolve a mesma; senão cria outra no fim.
   * Atômico por conta: dois pedidos juntos não criam duas fichas.
   */
  join(city: string, accountId: string, now: Date, preOpen: boolean, stillValid: (t: QueueTicket) => boolean): Promise<QueueTicket>;
}

export type SalePhase = 'soon' | 'queue' | 'launch' | 'ended';

export const queueOpensAt = (s: SaleConfig) => new Date(s.opensAt.getTime() - s.preQueueSeconds * 1000);

export function salePhase(s: SaleConfig, now: Date): SalePhase {
  const t = now.getTime();
  if (t >= s.endsAt.getTime()) return 'ended';
  if (t >= s.opensAt.getTime()) return 'launch';
  if (t >= queueOpensAt(s).getTime()) return 'queue';
  return 'soon';
}

export function turnOf(s: SaleConfig, t: QueueTicket) {
  const slot = Math.floor((t.position - 1) / s.batchSize) * s.batchSeconds * 1000;
  const admitAt = new Date(Math.max(t.joinedAt.getTime(), s.opensAt.getTime() + slot));
  return { admitAt, expiresAt: new Date(admitAt.getTime() + s.windowSeconds * 1000) };
}

export type TicketState = 'waiting' | 'admitted' | 'expired';

export function ticketState(s: SaleConfig, t: QueueTicket, now: Date): TicketState {
  const { admitAt, expiresAt } = turnOf(s, t);
  if (now.getTime() < admitAt.getTime()) return 'waiting';
  return now.getTime() < expiresAt.getTime() ? 'admitted' : 'expired';
}

export function validateSale(s: SaleConfig) {
  const bad = (message: string) => new AppError('invalid_request', message, 400);
  if (s.endsAt.getTime() <= s.opensAt.getTime()) throw bad('O fim do lançamento precisa vir depois da abertura.');
  if (s.batchSize < 1 || s.batchSeconds < 1 || s.windowSeconds < 60) throw bad('Lote de entrada, intervalo e janela inválidos.');
  if (s.maxLots < 1) throw bad('O limite por carteira precisa ser de pelo menos 1 lote.');
  if (s.preQueueSeconds < 0) throw bad('A fila não pode abrir depois da venda.');
}

/** Entrar na fila agora? Só entre a abertura da fila e o fim do lançamento. */
export async function joinQueue(store: SaleStore, s: SaleConfig, accountId: string, now: Date) {
  const phase = salePhase(s, now);
  if (phase === 'soon') {
    throw new AppError('queue_not_open', `A fila abre em ${queueOpensAt(s).toISOString()}.`, 409);
  }
  if (phase === 'ended') throw new AppError('sale_ended', 'O lançamento acabou: a venda está livre, sem fila.', 409);
  return store.join(s.city, accountId, now, phase === 'queue', (t) => ticketState(s, t, now) !== 'expired');
}

/**
 * Pode comprar agora? Fora do lançamento, sim, sem limite extra. No lançamento, só com a vez na fila, e o
 * limite por carteira vai para a reserva, que conta as compras dentro da mesma trava.
 */
export async function admitPurchase(store: SaleStore, city: string, accountId: string, now: Date) {
  const s = await store.getSale(city);
  if (!s) return null;
  const phase = salePhase(s, now);
  if (phase === 'ended') return null;
  if (phase !== 'launch') {
    throw new AppError('sale_not_open', `A venda abre em ${s.opensAt.toISOString()}. Entre na fila antes.`, 409);
  }
  const t = await store.latestTicket(city, accountId);
  if (!t) throw new AppError('queue_required', 'Lançamento com fila: entre na fila para comprar.', 409);
  const state = ticketState(s, t, now);
  if (state === 'waiting') {
    throw new AppError('queue_waiting', `Ainda não é a sua vez: posição ${t.position} na fila.`, 409);
  }
  if (state === 'expired') {
    throw new AppError('queue_expired', 'Sua vez passou: entre de novo na fila.', 409);
  }
  return { since: s.opensAt, max: s.maxLots };
}
