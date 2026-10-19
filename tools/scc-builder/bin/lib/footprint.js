/**
 * Projeção do modelo no chão — a "base" que o validate-lot confere contra o
 * polígono do lote.
 *
 * Mesma ideia do protótipo da cidade (docs/proposta-cidade-realista/main.js):
 * todos os vértices (amostrados) projetados em XZ, no espaço do mundo. Cabe
 * no lote se todos estão dentro do polígono com recuo; a área vem do contorno
 * convexo. Amostrar evita travar com modelos de milhões de vértices.
 */

/** Pontos por malha e no total, como no protótipo. */
export const MAX_POINTS_PER_MESH = 1500;
export const MAX_POINTS = 6000;

/**
 * Contorno convexo (monotone chain de Andrew).
 *
 * @param {Array<[number, number]>} points
 * @returns {Array<[number, number]>} vértices em sentido anti-horário
 */
export function convexHull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;

  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  const upper = [];

  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0)
      lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0)
      upper.pop();
    upper.push(q);
  }

  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Área de um polígono simples (fórmula do laço).
 *
 * @param {Array<[number, number]>} points
 */
export function polygonArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/**
 * Aplica uma matriz 4×4 column-major (glTF) a um ponto.
 *
 * @param {ArrayLike<number>} m
 * @param {[number, number, number]} v
 * @returns {[number, number, number]}
 */
export function transformPoint(m, v) {
  const [x, y, z] = v;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * Base e caixa do Document, no espaço do mundo (depois de eixo e escala).
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {{points: Array<[number, number]>, bbox: {min:number[], max:number[]} | null}}
 */
export function documentFootprint(doc) {
  const points = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const element = [0, 0, 0];

  const scenes = doc.getRoot().listScenes();
  const scene = doc.getRoot().getDefaultScene() ?? scenes[0];
  if (!scene) return { points, bbox: null };

  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;

    const matrix = node.getWorldMatrix();

    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;

      const count = position.getCount();
      const stride = Math.max(1, Math.floor(count / MAX_POINTS_PER_MESH));

      // A caixa usa todos os vértices; a base, só a amostra.
      for (let i = 0; i < count; i++) {
        position.getElement(i, element);
        const w = transformPoint(matrix, /** @type {[number, number, number]} */ (element));
        for (let k = 0; k < 3; k++) {
          if (w[k] < min[k]) min[k] = w[k];
          if (w[k] > max[k]) max[k] = w[k];
        }
        if (i % stride === 0) points.push([w[0], w[2]]);
      }
    }
  });

  if (points.length === 0) return { points, bbox: null };

  const sampled =
    points.length > MAX_POINTS
      ? points.filter((_, i) => i % Math.ceil(points.length / MAX_POINTS) === 0)
      : points;

  return { points: sampled, bbox: { min, max } };
}

/**
 * Conteúdo do modelo.meta.json lido pelo validate-lot.php.
 *
 * Os pontos saem arredondados ao milímetro: precisão de sobra para recuo em
 * metros e um arquivo bem menor.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{triangles:number, lods?:Array<{level:number, ratio:number, triangles:number}>}} extra
 */
export function buildMeta(doc, extra) {
  const { points, bbox } = documentFootprint(doc);
  const round = (n) => Math.round(n * 1000) / 1000;
  const hull = convexHull(points).map(([x, z]) => [round(x), round(z)]);

  return {
    format: 'scc-builder.meta/1',
    preset: 'scc',
    up_axis: 'y',
    units: 'm',
    bbox: bbox ? { min: bbox.min.map(round), max: bbox.max.map(round) } : null,
    height_m: bbox ? round(bbox.max[1] - bbox.min[1]) : 0,
    // Colisor de caixa: o próprio bbox, que o jogo usa sem ler a malha.
    collider: bbox ? { type: 'box', min: bbox.min.map(round), max: bbox.max.map(round) } : null,
    triangles: extra.triangles,
    lods: extra.lods ?? [],
    footprint: {
      hull,
      area_m2: round(polygonArea(hull)),
      points: points.map(([x, z]) => [round(x), round(z)]),
    },
  };
}
