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

/**
 * Estoque de lotes à venda, em SCITY a US$ 1. Vem das faixas genéricas
 * (`tiers`) ou do estoque real (`stock`: área × preço por m² da zona × escala),
 * embaralhado com a semente para a ordem de venda não favorecer um tamanho.
 */
export function landStock(land, rand) {
  const prices = [];
  const shuffle = (from) => {
    for (let i = prices.length - 1; i > from; i--) {
      const j = from + Math.floor(rand() * (i - from + 1));
      [prices[i], prices[j]] = [prices[j], prices[i]];
    }
  };
  const push = (lots) => {
    const scale = land.priceScale ?? 1;
    for (const lot of lots) {
      const price = lot.area * land.pricePerM2[lot.zone] * scale;
      for (let i = 0; i < lot.count; i++) prices.push(price);
    }
  };
  if (land.stock?.bairros) {
    // Bairro a bairro, na ordem de abertura; embaralhado só dentro de cada um.
    for (const bairro of land.stock.bairros) {
      const from = prices.length;
      push(bairro.lots);
      shuffle(from);
    }
  } else if (land.stock) {
    push(land.stock.lots);
    shuffle(0);
  } else {
    for (const tier of land.tiers) {
      for (let i = 0; i < tier.lots; i++) prices.push(tier.priceScity);
    }
  }
  return Float64Array.from(prices);
}

/**
 * Onde termina cada fase de venda no estoque: um bairro por fase (doc 03 §5).
 * Sem bairros, uma fase só com tudo.
 */
export function landPhases(land, total) {
  if (!land.stock?.bairros) return [total];
  const ends = [];
  let end = 0;
  for (const bairro of land.stock.bairros) {
    end += bairro.lots.reduce((s, l) => s + l.count, 0);
    ends.push(end);
  }
  return ends;
}

/** Quantas fases abrir: as já abertas ficam; abre outra enquanto o vendido passa do limiar. */
export function openPhases(ends, opened, sold, threshold) {
  let n = opened;
  while (n < ends.length && sold >= threshold * ends[n - 1]) n++;
  return n;
}

/**
 * Demanda que reage ao preço: lote mais caro que a referência vende menos.
 * Elasticidade 0 = demanda fixa; 1 = o gasto total quase não muda com o preço.
 */
export function buyChanceAt(base, price, land) {
  const elasticity = land.elasticity ?? 0;
  if (elasticity === 0 || price <= 0) return base;
  const factor = Math.min(land.maxDemandBoost ?? 3, (land.referencePriceScity / price) ** elasticity);
  return base * factor;
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
