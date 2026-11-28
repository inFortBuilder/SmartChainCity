// Caminho em volta dos obstáculos para o clique de andar do street view (mundo aberto, fase 2).
//
// O clique ia em linha reta e parava na primeira gôndola, ilha ou parede. Agora:
// 1. A* numa grade de 0,4 m em volta da origem e do destino, com 8 vizinhos, sobre o chão andável
//    (\`walkable(x, z)\`: rua, calçada, salão das lojas). Cada nó precisa de folga: o centro e 4 pontos a
//    \`clearance\` dele também são andáveis, para o avatar não raspar nas quinas.
// 2. O caminho é alisado por linha de visada: de cada ponto, pula para o mais longe que se vê em linha
//    reta (amostrada a cada 0,2 m, com a mesma folga).
//
// Sem caminho (destino cercado ou longe demais), devolve null e o street view cai na linha reta.
//
// PREMISSAS: grade de 0,4 m, folga de 0,25 m, margem de 12 m e no máximo 60 mil nós.

export const PATH = { cell: 0.4, clearance: 0.25, margin: 12, maxNodes: 60000, sightStep: 0.2 };

/** Ponto com folga: o centro e os 4 lados a \`r\` metros são andáveis. */
export const roomy = (walkable, x, z, r) =>
  walkable(x, z) && walkable(x + r, z) && walkable(x - r, z) && walkable(x, z + r) && walkable(x, z - r);

/** Linha reta de a até b inteira sobre chão andável (com folga). */
export function lineClear(walkable, ax, az, bx, bz, opt = PATH) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / opt.sightStep));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!roomy(walkable, ax + (bx - ax) * t, az + (bz - az) * t, opt.clearance)) return false;
  }
  return true;
}

/** Caminho de \`from\` até \`to\` ({x, z}): a lista de pontos (sem a origem) ou null. */
export function findPath(walkable, from, to, opt = PATH) {
  if (lineClear(walkable, from.x, from.z, to.x, to.z, opt)) return [{ x: to.x, z: to.z }];
  const { cell, margin } = opt;
  const x0 = Math.min(from.x, to.x) - margin, z0 = Math.min(from.z, to.z) - margin;
  const cols = Math.ceil((Math.max(from.x, to.x) + margin - x0) / cell) + 1;
  const rows = Math.ceil((Math.max(from.z, to.z) + margin - z0) / cell) + 1;
  if (cols * rows > opt.maxNodes * 4) return null;
  const idx = (c, r) => r * cols + c;
  const cx = (c) => x0 + c * cell, cz = (r) => z0 + r * cell;
  const toCell = (x, z) => [Math.round((x - x0) / cell), Math.round((z - z0) / cell)];
  // Andável com folga, calculado só quando o A* pergunta.
  const open = new Int8Array(cols * rows); // 0 não visto, 1 andável, 2 não
  const ok = (c, r) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    const k = idx(c, r);
    if (!open[k]) open[k] = roomy(walkable, cx(c), cz(r), opt.clearance) ? 1 : 2;
    return open[k] === 1;
  };
  const [sc, sr] = toCell(from.x, from.z);
  const [tc, tr] = toCell(to.x, to.z);
  // O destino pode cair rente a uma peça: vale o nó andável mais perto dele (até 1 m).
  let goal = null;
  for (let rad = 0; rad <= 3 && !goal; rad++) {
    for (let dr = -rad; dr <= rad && !goal; dr++) for (let dc = -rad; dc <= rad && !goal; dc++) if (ok(tc + dc, tr + dr)) goal = [tc + dc, tr + dr];
  }
  if (!goal) return null;
  const g = new Float32Array(cols * rows).fill(Infinity);
  const came = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  // Fila de prioridade (heap binário) por f = g + h.
  const heap = [];
  const push = (k, f) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (c, r) => {
    const dx = Math.abs(c - goal[0]), dz = Math.abs(r - goal[1]);
    return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)) * cell;
  };
  const start = idx(sc, sr);
  g[start] = 0;
  push(start, h(sc, sr));
  const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  const goalK = idx(goal[0], goal[1]);
  let visited = 0;
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goalK) break;
    if (++visited > opt.maxNodes) return null;
    const c = k % cols, r = (k / cols) | 0;
    for (const [dc, dr, w] of N8) {
      const nc = c + dc, nr = r + dr;
      if (!ok(nc, nr)) continue;
      // Na diagonal, os dois lados também precisam ser andáveis (não corta a quina).
      if (dc && dr && (!ok(c + dc, r) || !ok(c, r + dr))) continue;
      const nk = idx(nc, nr);
      const ng = g[k] + w * cell;
      if (ng < g[nk]) {
        g[nk] = ng;
        came[nk] = k;
        push(nk, ng + h(nc, nr));
      }
    }
  }
  if (came[goalK] === -1 && goalK !== start) return null;
  // Do destino até a origem, depois alisa por linha de visada.
  const raw = [];
  for (let k = goalK; k !== -1 && k !== start; k = came[k]) raw.push({ x: cx(k % cols), z: cz((k / cols) | 0) });
  raw.reverse();
  if (!raw.length) return [{ x: to.x, z: to.z }];
  const out = [];
  let ax = from.x, az = from.z, i = 0;
  while (i < raw.length) {
    let j = raw.length - 1;
    while (j > i && !lineClear(walkable, ax, az, raw[j].x, raw[j].z, opt)) j--;
    out.push(raw[j]);
    ax = raw[j].x;
    az = raw[j].z;
    i = j + 1;
  }
  // O último ponto é o destino pedido, se dá para chegar nele em linha reta.
  const last = out[out.length - 1];
  if (lineClear(walkable, last.x, last.z, to.x, to.z, opt)) out.push({ x: to.x, z: to.z });
  return out;
}
