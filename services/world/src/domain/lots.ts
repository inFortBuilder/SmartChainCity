import { AppError } from '@scc/shared';

/**
 * Lotes da cidade e venda primária (doc 03 §5, doc 13 §3, ADR-0012). A
 * geometria fica nos arquivos estáticos por bairro (tools/scc-builder
 * city-chunks); o servidor guarda o que muda: situação, dono e preço.
 */

export interface Zone {
  key: string;
  label: string;
  /** US$ por m² (doc 13 §3): o preço é fixado em dólar e pago em SCITY. */
  usdPerM2: number;
  maxHeightM: number;
  far: number;
  setbackM: number;
}

export interface City {
  code: string;
  name: string;
  zones: Zone[];
  /** Bairros abertos à venda, contados do centro para fora (0..openCount-1). */
  openCount: number;
  districtCount: number;
  /** Fração vendida dos bairros abertos que abre o próximo (doc 03 §5). */
  releaseThreshold: number;
}

export type LotStatus = 'vacant' | 'reserved' | 'sold' | 'civic';

export interface Lot {
  city: string;
  id: number;
  district: number;
  zone: string;
  areaM2: number;
  status: LotStatus;
  ownerAccountId: string | null;
  reservedBy: string | null;
  reservedUntil: Date | null;
  /** Compra que segura a reserva: só ela pode confirmar o lote. */
  reservationId: string | null;
  soldAt: Date | null;
}

export type PurchaseStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface Purchase {
  id: string;
  city: string;
  lotId: number;
  accountId: string;
  /** Preço em wei de SCITY (18 casas), fixado na reserva. */
  priceWei: bigint;
  priceUsd: number;
  status: PurchaseStatus;
  createdAt: Date;
}

/** Quanto tempo a reserva segura o lote enquanto o pagamento passa pelo ledger. */
export const RESERVATION_MS = 2 * 60_000;

/** Teto de área de um jogador num bairro (doc 13 §3: "até 30% da área do bairro"). */
export const AREA_CAP_SHARE = 0.3;

const WEI = 10n ** 18n;

/** Preço em dólar e em wei de SCITY, pela cotação (US$ por SCITY). Arredonda em micro-SCITY. */
export function priceOf(areaM2: number, zone: Zone, scityUsd: number) {
  const priceUsd = Math.round(areaM2 * zone.usdPerM2 * 100) / 100;
  const micro = BigInt(Math.round((priceUsd / scityUsd) * 1e6));
  return { priceUsd, priceWei: (micro * WEI) / 1_000_000n };
}

export const lotCode = (city: string, id: number) => `${city.slice(0, 3).toUpperCase()}-${String(id + 1).padStart(6, '0')}`;

const notForSale = (message: string) => new AppError('lot_not_for_sale', message, 409);

/** O lote está livre agora? Reserva vencida conta como livre. */
export const isAvailable = (lot: Lot, now: Date) =>
  lot.status === 'vacant' || (lot.status === 'reserved' && (lot.reservedUntil?.getTime() ?? 0) <= now.getTime());

/**
 * Pode comprar? `owned` são os lotes que o jogador já tem na cidade;
 * `districtArea` é a área somada dos lotes do bairro.
 */
export function checkPurchase(
  lot: Lot,
  city: City,
  buyer: { accountId: string; owned: Pick<Lot, 'district' | 'areaM2'>[]; districtArea: number },
  now: Date,
) {
  if (lot.status === 'civic') throw notForSale('Este lote é da Prefeitura.');
  if (lot.status === 'sold') throw notForSale('Este lote já tem dono.');
  if (lot.status === 'reserved' && !isAvailable(lot, now) && lot.reservedBy !== buyer.accountId) {
    throw new AppError('lot_reserved', 'Outro jogador está comprando este lote agora.', 409);
  }
  if (lot.district >= city.openCount) {
    throw new AppError('district_closed', 'Este bairro ainda não abriu para venda.', 409);
  }
  // doc 03 §5: um bairro por jogador na região.
  const other = buyer.owned.find((o) => o.district !== lot.district);
  if (other) {
    throw new AppError('other_district', `Seus lotes ficam no bairro ${other.district + 1}: compre lá.`, 409);
  }
  const area = buyer.owned.reduce((s, o) => s + o.areaM2, 0) + lot.areaM2;
  if (area > buyer.districtArea * AREA_CAP_SHARE) {
    throw new AppError('area_cap', `Um jogador pode ter até ${AREA_CAP_SHARE * 100}% da área do bairro.`, 409);
  }
}

/**
 * Liberação por bairro (doc 03 §5): enquanto os bairros abertos passarem do
 * limiar de vendidos, abre o próximo. `sold` e `forSale` contam só os lotes
 * vendáveis (sem os da Prefeitura) dos bairros já abertos.
 */
export function nextOpenCount(
  city: Pick<City, 'openCount' | 'districtCount' | 'releaseThreshold'>,
  soldAndForSale: (openCount: number) => { sold: number; forSale: number },
): number {
  let open = city.openCount;
  while (open < city.districtCount) {
    const { sold, forSale } = soldAndForSale(open);
    if (forSale === 0 || sold / forSale < city.releaseThreshold) break;
    open++;
  }
  return open;
}

/** Persistência. Memória e Postgres passam pelo mesmo teste de contrato. */
export interface WorldStore {
  /** Carrega (ou recarrega) a cidade; lotes já vendidos mantêm o dono. */
  importCity(city: City, lots: Pick<Lot, 'id' | 'district' | 'zone' | 'areaM2' | 'status'>[]): Promise<void>;
  getCity(code: string): Promise<City | null>;
  districts(code: string): Promise<{ order: number; lots: number; sold: number; forSale: number; areaM2: number }[]>;
  lotsOfDistrict(code: string, district: number): Promise<Lot[]>;
  getLot(code: string, id: number): Promise<Lot | null>;
  lotsOf(accountId: string): Promise<Lot[]>;
  /**
   * Trava o lote, confere a compra e reserva para o comprador; devolve a
   * compra pendente. Pedido repetido do mesmo comprador devolve a mesma compra.
   */
  reserve(code: string, lotId: number, accountId: string, now: Date, price: (lot: Lot, city: City) => { priceWei: bigint; priceUsd: number }): Promise<Purchase>;
  /** Pagamento feito: o lote passa a ser do comprador. false se a reserva se perdeu (vencida e tomada). */
  confirm(purchaseId: string, now: Date): Promise<boolean>;
  /** Pagamento recusado ou devolvido: libera o lote. */
  fail(purchaseId: string, status: 'failed' | 'refunded'): Promise<void>;
  /** Compras pendentes mais antigas que `before`: o job resolve. */
  stalePending(before: Date, limit: number): Promise<Purchase[]>;
}

/** Quem cobra o lote: o ledger do economy. Separado para os testes trocarem por um falso. */
export interface LandPayments {
  /** SCITY do jogador para a Prefeitura. Idempotente pela compra. */
  charge(purchase: Purchase): Promise<void>;
  /** Devolve o valor, quando a reserva se perdeu depois de pago. Idempotente pela compra. */
  refund(purchase: Purchase): Promise<void>;
}
