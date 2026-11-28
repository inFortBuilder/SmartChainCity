/**
 * Kit de ruas do street view: as peças escolhidas do "modular kit city build v2" (FBX de terceiros, sem
 * licença confirmada, fica só em .local/) e como cada uma é normalizada.
 *
 * O FBX é uma cena com 321 peças soltas, em centímetros, chamadas só "modular_kitNN". Os códigos abaixo
 * foram conferidos de cima, uma a uma (docs/desenvolvimento/street-view.md, "Kit de ruas"):
 * - reta2: 2 faixas com a linha amarela no meio (7,71 × 5,70 m);
 * - reta4: 4 faixas (15,42 × 5,70 m);
 * - cruz2: cruzamento em + de 2 faixas (18,81 m), com faixas de pedestre e "PARE". No FBX são três peças: o
 *   miolo (238) e o asfalto dos dois braços dos lados (239 e 240), juntadas numa só;
 * - cruz4: cruzamento em + de 4 faixas (26,52 m);
 * - faixa: faixa de pedestre de 4 faixas (15,42 × 1,43 m);
 * - meiofio: meio-fio de 1,43 m de largura, 5,70 m de comprimento;
 * - calcada: piso da calçada (5,70 × 5,70 m);
 * - asfalto: asfalto liso (7,71 × 7,71 m), para os trechos em que nenhuma peça cabe.
 *
 * Normalizar: a transformação da cena vai para os vértices (em metros), o centro da peça vai para a origem
 * em x e z, e o chão da peça para y = 0. No FBX, a rua de todas as peças escolhidas já corre em z (as linhas
 * das faixas ficam em z): a largura da rua é x e o comprimento da peça, z. As retas são mais largas que
 * compridas (7,71 m de largura por 5,70 m), então o eixo mais comprido não diz o sentido da rua.
 */
/** Código → nome da peça no FBX, ou a lista de peças que viram uma só. */
export const ROAD_PIECES = {
  reta2: 'modular_kit05',
  reta4: 'modular_kit02',
  cruz2: ['modular_kit238', 'modular_kit239', 'modular_kit240'],
  cruz4: 'modular_kit237',
  faixa: 'modular_kit65',
  meiofio: 'modular_kit17',
  calcada: 'modular_kit14',
  asfalto: 'modular_kit233',
};

/**
 * Normaliza as posições (já no mundo, em metros): centro em x e z na origem e chão em y = 0. Com
 * `alongZ`, gira 90° a peça mais comprida em x do que em z (para um kit em que o eixo comprido é o da
 * rua; não é o caso deste). Devolve as posições novas e as medidas {w (x), l (z), h}.
 */
export function normalizePositions(pos, { alongZ = false } = {}) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]);
    maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]);
    maxY = Math.max(maxY, pos[i + 1]);
    minZ = Math.min(minZ, pos[i + 2]);
    maxZ = Math.max(maxZ, pos[i + 2]);
  }
  const cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2;
  const rotate = alongZ && maxX - minX > maxZ - minZ + 1e-6;
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] - cx,
      y = pos[i + 1] - minY,
      z = pos[i + 2] - cz;
    // Girar 90° em y: (x, z) → (−z, x).
    out[i] = rotate ? -z : x;
    out[i + 1] = y;
    out[i + 2] = rotate ? x : z;
  }
  const w = rotate ? maxZ - minZ : maxX - minX;
  const l = rotate ? maxX - minX : maxZ - minZ;
  return {
    positions: out,
    size: { w: round(w), l: round(l), h: round(maxY - minY) },
    rotated: rotate,
  };
}

/** Gira as normais como as posições (90° em y, quando a peça foi girada). */
export function rotateNormals(nor, rotated) {
  if (!rotated) return nor;
  const out = new Float32Array(nor.length);
  for (let i = 0; i < nor.length; i += 3) {
    out[i] = -nor[i + 2];
    out[i + 1] = nor[i + 1];
    out[i + 2] = nor[i];
  }
  return out;
}

/** UV do FBX (v para cima, como o three lê) para o glTF (v para baixo). */
export function flipV(uv) {
  const out = new Float32Array(uv.length);
  for (let i = 0; i < uv.length; i += 2) {
    out[i] = uv[i];
    out[i + 1] = 1 - uv[i + 1];
  }
  return out;
}

const round = (v) => Math.round(v * 100) / 100;
