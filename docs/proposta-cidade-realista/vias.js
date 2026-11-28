// Faixas de trânsito a partir do grafo das ruas (ruas-grafo.js), para os carros (carros.js).
//
// Cada trecho do grafo vira duas faixas, uma em cada sentido, deslocadas para a direita de quem anda (mão
// direita): a faixa de ida fica do lado direito da linha do meio, a de volta do outro. O carro anda pela
// geometria da faixa, sem "procurar o meio-fio": não tem como ir na contramão.
// - As faixas param antes do cruzamento (a meia largura da rua mais larga dele, vezes 0,6) e o carro passa pelo
//   cruzamento numa curva (Bézier quadrática) até a faixa que escolheu: reto é o mais provável (peso 3),
//   virar à direita ou à esquerda pesa 1. Volta (o mesmo trecho no outro sentido) só no fim de rua.
// - Distância: o modelo de motorista inteligente (IDM). O carro quer a velocidade dele, mas guarda do da
//   frente 2,5 m mais 1,2 s de viagem, e freia suave conforme a diferença de velocidade. Sinal fechado,
//   ponto de ônibus, pedestre e o avatar entram como obstáculos parados.
//
// PREMISSAS: faixa a 1/4 da largura da linha do meio (mín. 1,6 m); cruzamento a 0,6 vez a rua mais larga;
// IDM com 2,5 m de folga, 1,2 s de tempo de seguimento, 2 m/s² de aceleração e 3 m/s² de freio confortável.

export const ROUTE = { laneShare: 0.25, minLane: 1.6, junction: 0.6, s0: 2.5, T: 1.2, aMax: 2, b: 3, hardBrake: 9, straightWeight: 3 };

const len = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);

/** Ponto e rumo a `s` metros do começo de uma linha (rumo como o do street view: 0 = +z). */
export function along(pts, s) {
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (run + seg >= s || i === pts.length - 1) {
      const t = seg ? Math.max(0, Math.min(1, (s - run) / seg)) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: Math.atan2(b.x - a.x, b.z - a.z) };
    }
    run += seg;
  }
  return { x: pts[0].x, z: pts[0].z, h: 0 };
}

/** A linha deslocada `off` m para a direita de quem anda por ela (direita = (−dz, dx) do rumo). */
export function offsetRight(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    return { x: p.x + (-dz / l) * off, z: p.z + (dx / l) * off };
  });
}

/** Corta `a` metros do começo e `b` do fim da linha (vazia se não sobrar 1 m). */
export function cut(pts, a, b) {
  const total = len(pts);
  if (total - a - b < 1) return [];
  const out = [along(pts, a)];
  let run = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    run += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (run > a && run < total - b) out.push(pts[i]);
  }
  out.push(along(pts, total - b));
  return out.map(({ x, z }) => ({ x, z }));
}

/**
 * As faixas do grafo: {lanes, out (nó → faixas que saem dele), nodes (id → nó)}. Faixa: {id, edge, from, to,
 * width, pts, length, reverse (a do outro sentido)}.
 */
export function buildLanes(graph, o = ROUTE) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  // Quanto cada cruzamento ocupa a partir do centro.
  const radius = new Map();
  for (const n of graph.nodes) {
    if (n.edges.length < 3) continue;
    radius.set(n.id, o.junction * Math.max(...n.edges.map((id) => graph.edges[id].width)));
  }
  const lanes = [];
  const out = new Map();
  for (const e of graph.edges) {
    const off = Math.max(o.minLane, e.width * o.laneShare);
    const ra = radius.get(e.a) ?? 0, rb = radius.get(e.b) ?? 0;
    const fwd = cut(offsetRight(e.points, off), ra, rb);
    const back = cut(offsetRight(e.points.slice().reverse(), off), rb, ra);
    if (fwd.length < 2 || back.length < 2) continue;
    const l1 = { id: lanes.length, edge: e.id, from: e.a, to: e.b, width: e.width, pts: fwd, length: len(fwd) };
    const l2 = { id: lanes.length + 1, edge: e.id, from: e.b, to: e.a, width: e.width, pts: back, length: len(back) };
    l1.reverse = l2;
    l2.reverse = l1;
    lanes.push(l1, l2);
    for (const l of [l1, l2]) {
      if (!out.has(l.from)) out.set(l.from, []);
      out.get(l.from).push(l);
    }
  }
  return { lanes, out, nodes };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A próxima faixa no fim de `lane`: reto pesa 3, virar pesa 1; voltar pelo mesmo trecho só se não houver
 * outra (fim de rua). Devolve {lane, turn: 'reto' | 'direita' | 'esquerda' | 'volta'} ou null.
 */
export function chooseNext(net, lane, rand = Math.random, o = ROUTE) {
  const options = (net.out.get(lane.to) ?? []).filter((l) => l.edge !== lane.edge);
  const endH = along(lane.pts, lane.length).h;
  if (!options.length) return lane.reverse ? { lane: lane.reverse, turn: 'volta' } : null;
  const scored = options.map((l) => {
    const d = wrap(along(l.pts, 0).h - endH);
    const turn = Math.abs(d) < Math.PI / 5 ? 'reto' : d < 0 ? 'direita' : 'esquerda';
    return { lane: l, turn, w: turn === 'reto' ? o.straightWeight : 1 };
  });
  let r = rand() * scored.reduce((s, x) => s + x.w, 0);
  for (const x of scored) if ((r -= x.w) <= 0) return x;
  return scored[scored.length - 1];
}

/**
 * Sorteio fixo da linha de ônibus no fim de `lane`: depende só da linha, do lugar do cruzamento (em passos
 * de 3 m) e do rumo de chegada (em 8 setores). Quem chega ao mesmo cruzamento pelo mesmo lado vira sempre
 * igual; como o grafo é finito, o caminho fecha num circuito: a linha.
 */
export function lineDraw(net, lane, line) {
  const n = net.nodes.get(lane.to);
  const h = along(lane.pts, lane.length).h;
  const sector = ((Math.round(h / (Math.PI / 4)) % 8) + 8) % 8;
  const text = `${line}|${Math.round((n?.x ?? 0) / 3)}|${Math.round((n?.z ?? 0) / 3)}|${sector}`;
  let x = 2166136261;
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822507) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** A próxima faixa da linha `line` (como chooseNext, com o sorteio fixo de lineDraw). */
export const chooseLine = (net, lane, line, o = ROUTE) => chooseNext(net, lane, () => lineDraw(net, lane, line), o);

/**
 * A curva pelo cruzamento, do fim de `a` ao começo de `b`: Bézier quadrática com o controle onde as duas
 * tangentes se cruzam (ou no meio, quando são quase paralelas). Na volta, o controle vai à frente do fim.
 * Devolve os pontos (12) e o comprimento.
 */
export function connector(a, b) {
  const p0 = along(a.pts, a.length), p2 = along(b.pts, 0);
  const d0 = { x: Math.sin(p0.h), z: Math.cos(p0.h) }, d2 = { x: Math.sin(p2.h), z: Math.cos(p2.h) };
  let c;
  const den = d0.x * d2.z - d0.z * d2.x;
  if (Math.abs(den) > 0.2) {
    const t = ((p2.x - p0.x) * d2.z - (p2.z - p0.z) * d2.x) / den;
    c = { x: p0.x + d0.x * t, z: p0.z + d0.z * t };
    // Controle longe demais (tangentes quase opostas): fica no meio.
    if (t < 0 || t > 3 * Math.hypot(p2.x - p0.x, p2.z - p0.z)) c = null;
  }
  if (!c) {
    const reach = Math.max(3, Math.hypot(p2.x - p0.x, p2.z - p0.z));
    c = { x: (p0.x + p2.x) / 2 + d0.x * reach * 0.6, z: (p0.z + p2.z) / 2 + d0.z * reach * 0.6 };
  }
  const pts = [];
  for (let i = 0; i <= 11; i++) {
    const t = i / 11, u = 1 - t;
    pts.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * c.z + t * t * p2.z });
  }
  return { pts, length: len(pts) };
}

/**
 * Aceleração do IDM: `v` a velocidade, `v0` a desejada, `gap` a distância até o obstáculo (de para-choque a
 * para-choque) e `dv` a diferença para ele (v − v do da frente). Sem obstáculo, gap = Infinity.
 */
export function idm(v, v0, gap, dv, o = ROUTE) {
  const free = 1 - Math.pow(v / Math.max(0.1, v0), 4);
  if (!Number.isFinite(gap)) return o.aMax * free;
  const sStar = o.s0 + Math.max(0, v * o.T + (v * dv) / (2 * Math.sqrt(o.aMax * o.b)));
  return Math.max(-o.hardBrake, o.aMax * (free - Math.pow(sStar / Math.max(0.1, gap), 2)));
}
