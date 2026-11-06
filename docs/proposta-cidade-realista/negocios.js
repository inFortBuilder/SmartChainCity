// Catálogo e regras dos negócios que o jogador abre no próprio lote.
// Sem DOM nem Three.js: dá para testar com o Node.
//
// Tipos e regras de dono vêm do GDD (doc 02 §5); zonas, do doc 03 §3. Custo,
// obra, receita e despesa NÃO estão nos documentos: são premissas deste
// protótipo, escolhidas para o retorno ficar entre 40 e 78 dias (doc 04 §6).
// Negócio vende a NPCs, então é um faucet de THALER que o simulador econômico
// ainda não modela.

export const DAY_MS = 24 * 3600 * 1000;

/** Até quantos dias de lucro acumulam sem coletar: obriga o jogador a voltar. */
export const MAX_ACCRUAL_DAYS = 7;

const COMERCIO = ['mixed', 'commercial'];

export const BUSINESSES = [
  { key: 'casa_t1', label: 'Casa T1', icon: '🏠', zones: ['residential'], cost: 4000, buildHours: 24, revenue: 22, expense: 8, height: 7, color: 0xf2e6d8, note: 'Moradia: você deixa de pagar aluguel e recebe uma renda pequena.' },
  { key: 'casa_t3', label: 'Casa T3 com pequeno negócio', icon: '🏡', zones: ['residential'], cost: 9000, buildHours: 48, revenue: 210, expense: 75, height: 9, color: 0xf5d6a8, note: 'Casa com comércio no térreo (doc 03 §6.1).' },
  { key: 'mercado', label: 'Mercado', icon: '🛒', zones: COMERCIO, cost: 12000, buildHours: 72, revenue: 480, expense: 250, height: 8, color: 0x7cc84a },
  { key: 'fast_food', label: 'Fast food', icon: '🍔', zones: COMERCIO, cost: 10000, buildHours: 48, revenue: 420, expense: 230, height: 7, color: 0xf59e0b },
  { key: 'farmacia', label: 'Farmácia', icon: '💊', zones: COMERCIO, cost: 11000, buildHours: 72, revenue: 430, expense: 220, height: 7, color: 0x34d399, requires: { profession: 'Enfermeiro' }, note: 'O GDD exige um avatar enfermeiro como dono.' },
  { key: 'academia', label: 'Academia', icon: '🏋️', zones: COMERCIO, cost: 8000, buildHours: 48, revenue: 300, expense: 160, height: 9, color: 0x60a5fa },
  { key: 'oficina', label: 'Oficina', icon: '🔧', zones: COMERCIO, cost: 9000, buildHours: 48, revenue: 330, expense: 170, height: 8, color: 0x94a3b8 },
  { key: 'pet_shop', label: 'Pet shop', icon: '🐾', zones: COMERCIO, cost: 7000, buildHours: 36, revenue: 260, expense: 140, height: 6, color: 0xf472b6 },
  { key: 'galeria', label: 'Galeria de arte', icon: '🖼️', zones: COMERCIO, cost: 6000, buildHours: 36, revenue: 190, expense: 100, height: 8, color: 0xc084fc },
  { key: 'hotel', label: 'Hotel', icon: '🏨', zones: COMERCIO, cost: 30000, buildHours: 120, revenue: 1100, expense: 620, height: 24, minArea: 1500, color: 0x38bdf8 },
];

export const byKey = (key) => BUSINESSES.find((b) => b.key === key);

/** Lucro por dia, em THALER. */
export const netPerDay = (biz) => biz.revenue - biz.expense;

/** Dias para o lucro pagar a obra. */
export const paybackDays = (biz) => Math.ceil(biz.cost / netPerDay(biz));

/**
 * O jogador pode abrir este negócio neste lote? Devolve todos os motivos,
 * para a tela mostrar por que um botão está desligado.
 *
 * @param {object} biz item de BUSINESSES
 * @param {{zone: string, area: number}} lot
 * @param {{profession: string, thaler: number}} player
 */
export function eligibility(biz, lot, player) {
  const reasons = [];
  if (!biz.zones.includes(lot.zone)) reasons.push('zona não permite');
  if (biz.minArea && lot.area < biz.minArea) reasons.push(`exige ${biz.minArea} m²`);
  if (biz.requires?.profession && player.profession !== biz.requires.profession) {
    reasons.push(`exige avatar ${biz.requires.profession.toLowerCase()}`);
  }
  if (player.thaler < biz.cost) reasons.push('THALER insuficiente');
  return { ok: reasons.length === 0, reasons };
}

/**
 * Situação de um negócio no tempo do jogo.
 *
 * @param {{key: string, startedAt: number, lastClaim?: number}} business
 * @param {number} now tempo do jogo, em ms
 */
export function businessState(business, now) {
  const biz = byKey(business.key);
  const buildMs = biz.buildHours * 3600 * 1000;
  const elapsed = now - business.startedAt;
  if (elapsed < buildMs) {
    return { phase: 'obra', progress: elapsed / buildMs, leftMs: buildMs - elapsed, accrued: 0 };
  }
  const openedAt = business.startedAt + buildMs;
  const since = Math.max(openedAt, business.lastClaim ?? 0);
  const days = Math.min(MAX_ACCRUAL_DAYS, (now - since) / DAY_MS);
  return {
    phase: 'aberto',
    progress: 1,
    leftMs: 0,
    accrued: Math.floor(days * netPerDay(biz)),
    full: days >= MAX_ACCRUAL_DAYS,
  };
}
