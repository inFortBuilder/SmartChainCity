/** Fórmulas puras da economia (doc 04 §4 e §5), testadas isoladamente. */

/** Valor em dólar de 1 THALER: fixo, porque o conversor flutua com o preço do SCITY. */
export function thalerUsd(currency) {
  return 1 / currency.thalerPerScityAtOneUsd;
}

/** THALER por SCITY ao preço dado: US$ 1 → 20; US$ 0,50 → 10. */
export function converter(currency, priceUsd) {
  return currency.thalerPerScityAtOneUsd * priceUsd;
}

/** Multiplicador de atributos: Saúde × Felicidade × (Exp. + Pet, com teto). */
export function attributeMultiplier(multipliers, health, happiness) {
  const expPet = Math.min(multipliers.expPet, multipliers.expPetCap);
  return multipliers.health[health] * multipliers.happiness[happiness] * expPet;
}

/** Ganho do turno antes dos danos. */
export function shiftEarnings({ base, attributes, regularized, work, eventWeek }) {
  const reg = regularized ? 1 : work.unregularizedFactor;
  const event = eventWeek ? 1 + work.weeklyEventBonus : 1;
  return base * attributes * reg * event;
}

/** Liberação acumulada do pool P2E até o dia (0-based), linear dentro de cada ano. */
export function poolReleasedUntil(yearly, day) {
  const year = Math.floor(day / 365);
  let total = 0;
  for (let y = 0; y < Math.min(year, yearly.length); y++) total += yearly[y];
  if (year < yearly.length) total += (yearly[year] * ((day % 365) + 1)) / 365;
  return total;
}

/**
 * Freio do pool: 0 até `start` de uso do liberado, 1 no limite. Conforme ele
 * sobe, o saque diário cai e o spread sobe; o saldo fica retido em THALER.
 */
export function poolBrakeLevel(scityPaid, released, start) {
  if (released <= 0) return 0;
  const used = scityPaid / released;
  return Math.max(0, Math.min(1, (used - start) / (1 - start)));
}

/** Jogadores-alvo no dia: crescimento linear de start a end no horizonte. */
export function targetPlayers(growth, day, days) {
  return Math.round(growth.start + ((growth.end - growth.start) * day) / Math.max(1, days - 1));
}

/** Mediana; dias sem payback (null) contam como infinito. */
export function medianPayback(values) {
  if (values.length === 0) return null;
  const sorted = values.map((v) => (v === null ? Infinity : v)).sort((a, b) => a - b);
  const m = sorted[Math.floor((sorted.length - 1) / 2)];
  return Number.isFinite(m) ? m : null;
}
