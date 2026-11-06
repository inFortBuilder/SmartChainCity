/**
 * Simulação diária por agentes.
 *
 * O THALER é contabilizado como ledger: todo crédito vem de um faucet ou de
 * outra conta, todo débito vai a um sink, a outra conta ou à conversão.
 * Pagamento nunca deixa saldo negativo; o que faltou vira `unpaid`.
 *
 * Fora do modelo (ver README): marketplace, corridas, fazenda, staking,
 * revenda de lotes e preço endógeno do SCITY (o preço é dado pelo cenário).
 */
import {
  attributeMultiplier,
  converter,
  medianPayback,
  buyChanceAt,
  landStock,
  poolBrakeLevel,
  poolReleasedUntil,
  shiftEarnings,
  targetPlayers,
  thalerUsd,
} from './model.js';
import { mulberry32 } from './rng.js';

/** Sorteia o índice de uma lista de { share }. */
function pickShares(entries, r) {
  let acc = 0;
  for (let i = 0; i < entries.length; i++) {
    acc += entries[i].share;
    if (r < acc) return i;
  }
  return entries.length - 1;
}

const entriesOf = (block) =>
  Object.entries(block)
    .filter(([k]) => k !== 'fonte')
    .map(([key, v]) => ({ key, ...v }));

const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

/**
 * @param {object} params conteúdo de params/base.json
 * @param {{priceUsd:number, growth:{start:number,end:number}, sinkScale?:number, incomeSink?:number, land?:boolean, brake?:boolean, days?:number, seed?:number}} run
 */
export function simulate(params, run) {
  const days = run.days ?? params.days;
  const sinkScale = run.sinkScale ?? 1;
  // Dreno proporcional à renda: pesa igual em todas as raridades.
  const incomeSink = run.incomeSink ?? params.sinks.incomeRate;
  const B = params.poolBrake;
  const brakeOn = run.brake ?? B.enabled;
  const L = params.land;
  const landOn = run.land ?? L.enabled;
  const rand = mulberry32(run.seed ?? params.seed);

  const rarities = entriesOf(params.rarities);
  const profiles = entriesOf(params.profiles);
  const { sinks: S, work: W, currency: C } = params;

  const usdPerThaler = thalerUsd(C);
  const rate = converter(C, run.priceUsd);
  const exitNet = 1 - C.exitSpread;
  const profileMult = profiles.map((p) =>
    attributeMultiplier(params.multipliers, p.health, p.happiness)
  );

  const cap = Math.max(run.growth.start, run.growth.end);
  const rarity = new Uint8Array(cap);
  const profile = new Uint8Array(cap);
  const owner = new Uint8Array(cap);
  const regularized = new Uint8Array(cap);
  const active = new Uint8Array(cap);
  const joined = new Int32Array(cap);
  const payback = new Int32Array(cap).fill(-1);
  const base = new Float64Array(cap);
  const balance = new Float64Array(cap);
  const cashUsd = new Float64Array(cap);
  const assetUsd = new Float64Array(cap);
  const investedUsd = new Float64Array(cap);

  let count = 0;
  const addAgent = (day) => {
    const i = count++;
    const ra = pickShares(rarities, rand());
    const pr = pickShares(profiles, rand());
    rarity[i] = ra;
    profile[i] = pr;
    // Com a venda de lotes ligada, imóvel só se compra: ninguém nasce dono.
    const startsOwner = rand() < profiles[pr].ownerShare;
    owner[i] = startsOwner && !landOn ? 1 : 0;
    regularized[i] = rand() < W.regularizedShare ? 1 : 0;
    base[i] = rarities[ra].baseMin + rand() * (rarities[ra].baseMax - rarities[ra].baseMin);
    active[i] = 1;
    joined[i] = day;
    investedUsd[i] = rarities[ra].comboUsd;
    return rarities[ra].comboUsd;
  };

  const faucets = { work: 0, propertyYield: 0 };
  const sinks = {
    food: 0,
    energy: 0,
    transport: 0,
    rentNpc: 0,
    repairs: 0,
    insurance: 0,
    iptu: 0,
    hospital: 0,
    income: 0,
    land: 0,
    property: 0,
    exitFee: 0,
  };
  let redeemedThaler = 0;
  let unpaid = 0;
  let transfers = 0;
  let abandonedThaler = 0;
  let scityPaid = 0;
  let usdIn = 0;
  let usdOut = 0;
  let poolDryDay = null;
  let brakeFirstDay = null;
  let brakeDays = 0;
  let peakBrake = 0;
  // Estoque montado com a mesma semente: a simulação continua reprodutível.
  const stock = landStock(L, rand);
  let stockIndex = 0;
  let landSold = 0;
  let landUsdIn = 0;
  let scityBought = 0;
  let landSoldOutDay = null;
  const daily = [];

  const pay = (i, amount, bucket) => {
    const paid = Math.min(balance[i], amount);
    balance[i] -= paid;
    if (bucket) sinks[bucket] += paid;
    unpaid += amount - paid;
    return paid;
  };

  for (let day = 0; day < days; day++) {
    const target = Math.min(cap, targetPlayers(run.growth, day, days));
    while (count < target) usdIn += addAgent(day);

    let rentPool = 0;
    let owners = 0;
    let dayFaucet = 0;
    const sinksBefore = sum(sinks);
    const iptuDay = day % 182 === 181;
    const eventGroup = Math.floor(day / 7) % 3;

    for (let i = 0; i < count; i++) {
      if (!active[i]) continue;
      const p = profiles[profile[i]];

      if (rand() < p.dailyChurn) {
        active[i] = 0;
        abandonedThaler += balance[i];
        continue;
      }

      const sick = rand() < S.hospitalChance;
      if (!sick && rand() < p.attendance) {
        let earn = shiftEarnings({
          base: base[i],
          attributes: profileMult[profile[i]],
          regularized: regularized[i] === 1,
          work: W,
          eventWeek: i % 3 === eventGroup,
        });
        if (rand() < W.damageChance) earn *= 1 - W.damageFraction;
        balance[i] += earn;
        faucets.work += earn;
        dayFaucet += earn;
        if (incomeSink > 0) pay(i, earn * incomeSink, 'income');
      }

      if (owner[i]) {
        owners++;
        const y = S.ownerYield * sinkScale;
        balance[i] += y;
        faucets.propertyYield += y;
        dayFaucet += y;
        pay(i, S.repairs * sinkScale, 'repairs');
        pay(i, S.insurance * sinkScale, 'insurance');
        if (iptuDay) pay(i, S.iptuSemiannual * sinkScale, 'iptu');
      } else {
        const paid = pay(i, S.rentRenter * sinkScale, null);
        sinks.rentNpc += paid * S.rentNpcShare;
        rentPool += paid * (1 - S.rentNpcShare);
      }

      pay(i, S.food * sinkScale, 'food');
      pay(i, S.energyPlan * sinkScale, 'energy');
      pay(i, S.transport * sinkScale, 'transport');
      if (sick) pay(i, S.hospitalFee, 'hospital');

      // Venda primária: dinheiro novo entra por fora; o saldo em THALER é sink.
      if (
        landOn &&
        !owner[i] &&
        stockIndex < stock.length &&
        rand() < buyChanceAt(p.buyChance, stock[stockIndex], L)
      ) {
        const priceScity = stock[stockIndex];
        // priceInUsd: o lote vale o mesmo em dólar a qualquer preço do SCITY.
        const lotThaler = priceScity * (L.priceInUsd ? C.thalerPerScityAtOneUsd : rate);
        const total = lotThaler + L.houseThaler;
        const usd = total * usdPerThaler;
        let bought = false;
        if (rand() < p.freshMoneyShare) {
          usdIn += usd;
          landUsdIn += usd;
          investedUsd[i] += usd;
          scityBought += priceScity;
          bought = true;
        } else if (balance[i] >= total + L.reserveThaler) {
          balance[i] -= total;
          sinks.land += lotThaler;
          sinks.property += L.houseThaler;
          bought = true;
        }
        if (bought) {
          owner[i] = 1;
          assetUsd[i] = usd;
          landSold++;
          if (++stockIndex >= stock.length) landSoldOutDay = day + 1;
        }
      }
    }

    // Aluguel é transferência entre jogadores: não emite nem drena.
    // Cada dono comporta poucos inquilinos; o excedente vai para imóveis do jogo.
    owners = 0;
    for (let i = 0; i < count; i++) {
      if (active[i] && owner[i]) owners++;
    }
    const share = owners > 0 ? Math.min(rentPool / owners, S.rentCapPerOwner * sinkScale) : 0;
    for (let i = 0; i < count; i++) {
      if (active[i] && owner[i]) balance[i] += share;
    }
    transfers += share * owners;
    sinks.rentNpc += rentPool - share * owners;

    const released = poolReleasedUntil(params.p2ePool.yearlyReleaseScity, day);
    let brakedToday = false;
    for (let i = 0; i < count; i++) {
      if (!active[i]) continue;
      const canWithdraw =
        day - joined[i] >= C.newAccountLockDays && balance[i] >= C.minWithdrawThaler;
      if (canWithdraw && rand() < profiles[profile[i]].withdrawChance) {
        const brake = brakeOn ? poolBrakeLevel(scityPaid, released, B.startUtilization) : 0;
        if (brake > 0) {
          brakedToday = true;
          peakBrake = Math.max(peakBrake, brake);
        }
        const spread = C.exitSpread + B.maxExtraSpread * brake;
        const net = 1 - spread;
        const amount = Math.min(balance[i], C.dailyWithdrawLimitThaler * (1 - brake));
        const scity = (amount * net) / rate;
        if (scityPaid + scity > released) {
          if (poolDryDay === null) poolDryDay = day + 1;
        } else {
          balance[i] -= amount;
          sinks.exitFee += amount * spread;
          redeemedThaler += amount * net;
          scityPaid += scity;
          cashUsd[i] += amount * net * usdPerThaler;
          usdOut += amount * net * usdPerThaler;
        }
      }
      if (payback[i] < 0) {
        const worth =
          cashUsd[i] + balance[i] * exitNet * usdPerThaler + assetUsd[i] * L.assetResale;
        if (worth >= investedUsd[i]) payback[i] = day - joined[i] + 1;
      }
    }

    if (brakedToday) {
      brakeDays++;
      if (brakeFirstDay === null) brakeFirstDay = day + 1;
    }

    daily.push({
      day: day + 1,
      players: count,
      faucet: dayFaucet,
      sink: sum(sinks) - sinksBefore,
      scityPaid,
    });
  }

  let liveBalance = 0;
  let allBalance = 0;
  let activeCount = 0;
  const cohort = rarities.map(() => []);
  for (let i = 0; i < count; i++) {
    allBalance += balance[i];
    if (active[i]) {
      activeCount++;
      liveBalance += balance[i];
      if (joined[i] === 0) cohort[rarity[i]].push(payback[i] < 0 ? null : payback[i]);
    }
  }

  const faucetTotal = sum(faucets);
  const sinkTotal = sum(sinks);

  return {
    days,
    priceUsd: run.priceUsd,
    sinkScale,
    incomeSink,
    players: count,
    activePlayers: activeCount,
    faucets,
    sinks,
    faucetTotal,
    sinkTotal,
    redeemedThaler,
    transfers,
    unpaid,
    abandonedThaler,
    ledgerError: faucetTotal - sinkTotal - redeemedThaler - allBalance,
    sinkFaucetRatio: faucetTotal > 0 ? sinkTotal / faucetTotal : 0,
    drainRatioWithRedemption: faucetTotal > 0 ? (sinkTotal + redeemedThaler) / faucetTotal : 0,
    dollarCoverage: usdOut > 0 ? usdIn / usdOut : Infinity,
    thalerPerCapita: activeCount > 0 ? liveBalance / activeCount : 0,
    scityPaid,
    scitySoldPerDay: scityPaid / days,
    poolDryDay,
    brakeFirstDay,
    brakeDays,
    peakBrake,
    usdIn,
    usdOut,
    landSold,
    landUsdIn,
    scityBought,
    landSoldOutDay,
    landStockLeft: stock.length - stockIndex,
    landPriceMedianScity: [...stock].sort((a, b) => a - b)[stock.length >> 1] ?? 0,
    paybackByRarity: Object.fromEntries(rarities.map((r, k) => [r.key, medianPayback(cohort[k])])),
    daily,
  };
}

/** Critério do ROADMAP E0.5 para um resultado. */
export function evaluateGate(result, gate) {
  const reasons = [];
  for (const [rarity, days] of Object.entries(result.paybackByRarity)) {
    if (days === null) reasons.push(`${rarity}: sem payback em ${result.days} dias`);
    else if (days < gate.paybackMinDays) {
      reasons.push(`${rarity}: payback ${days} d < ${gate.paybackMinDays}`);
    } else if (days > gate.paybackMaxDays) {
      reasons.push(`${rarity}: payback ${days} d > ${gate.paybackMaxDays}`);
    }
  }
  if (result.dollarCoverage < gate.minDollarCoverage) {
    reasons.push(`cobertura ${result.dollarCoverage.toFixed(2)} < ${gate.minDollarCoverage}`);
  }
  // Pool esgotado corta saques e melhora a cobertura à custa do jogador.
  if (result.poolDryDay !== null) reasons.push(`pool esgotou no dia ${result.poolDryDay}`);
  return { pass: reasons.length === 0, reasons };
}
