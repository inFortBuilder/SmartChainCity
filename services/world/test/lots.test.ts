import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type Lot, checkPurchase, lotCode, nextOpenCount, priceOf } from '../src/domain/lots.js';
import { testCity } from './fixtures.js';

const now = new Date('2026-11-12T12:00:00Z');
const lot = (over: Partial<Lot> = {}): Lot => ({
  city: 'teste',
  id: 1,
  district: 0,
  zone: 'mixed',
  areaM2: 100,
  status: 'vacant',
  ownerAccountId: null,
  reservedBy: null,
  reservedUntil: null,
  reservationId: null,
  soldAt: null,
  ...over,
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};

describe('priceOf', () => {
  it('preço em dólar pela zona, pago em SCITY pela cotação', () => {
    const mixed = testCity('t').zones[1]!;
    expect(priceOf(1000, mixed, 1)).toEqual({ priceUsd: 1560, priceWei: 1560n * 10n ** 18n });
    // SCITY a US$ 2: metade dos tokens.
    expect(priceOf(1000, mixed, 2).priceWei).toBe(780n * 10n ** 18n);
  });
});

describe('checkPurchase', () => {
  const city = testCity('t');
  const buyer = (owned: Pick<Lot, 'district' | 'areaM2'>[] = []) => ({ accountId: randomUUID(), owned, districtArea: 1000 });

  it('Prefeitura, vendido e bairro fechado não estão à venda', () => {
    expect(code(() => checkPurchase(lot({ status: 'civic' }), city, buyer(), now))).toBe('lot_not_for_sale');
    expect(code(() => checkPurchase(lot({ status: 'sold' }), city, buyer(), now))).toBe('lot_not_for_sale');
    expect(code(() => checkPurchase(lot({ district: 1 }), city, buyer(), now))).toBe('district_closed');
  });

  it('um bairro por jogador e teto de 30% da área do bairro', () => {
    expect(code(() => checkPurchase(lot(), { ...city, openCount: 2 }, buyer([{ district: 1, areaM2: 100 }]), now))).toBe('other_district');
    expect(code(() => checkPurchase(lot(), city, buyer([{ district: 0, areaM2: 200 }]), now))).toBeNull();
    expect(code(() => checkPurchase(lot(), city, buyer([{ district: 0, areaM2: 201 }]), now))).toBe('area_cap');
  });

  it('reserva de outro segura o lote; vencida, libera', () => {
    const held = lot({ status: 'reserved', reservedBy: randomUUID(), reservedUntil: new Date(now.getTime() + 60_000) });
    expect(code(() => checkPurchase(held, city, buyer(), now))).toBe('lot_reserved');
    const expired = { ...held, reservedUntil: new Date(now.getTime() - 1) };
    expect(code(() => checkPurchase(expired, city, buyer(), now))).toBeNull();
  });
});

describe('nextOpenCount', () => {
  const city = { openCount: 1, districtCount: 3, releaseThreshold: 0.7 };
  it('abre o próximo bairro quando os abertos passam de 70% vendidos', () => {
    expect(nextOpenCount(city, () => ({ sold: 6, forSale: 9 }))).toBe(1);
    expect(nextOpenCount(city, (open) => (open === 1 ? { sold: 7, forSale: 9 } : { sold: 7, forSale: 19 }))).toBe(2);
  });
  it('não passa do total de bairros', () => {
    expect(nextOpenCount(city, () => ({ sold: 10, forSale: 10 }))).toBe(3);
  });
});

describe('lotCode', () => {
  it('mostra o número começando em 1, como no mapa', () => {
    expect(lotCode('pittsburg', 17341)).toBe('PIT-017342');
  });
});
