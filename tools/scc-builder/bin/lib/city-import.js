/**
 * Cidade inteira em OBJ gerado do OpenStreetMap → camadas prontas para o mapa.
 *
 * O modelo chega com um objeto por etiqueta do OSM (`highway_service`,
 * `building=y`, `landuse=r1`…). Aqui ele vira poucas camadas com cor por
 * vértice, o que reduz centenas de objetos a poucas chamadas de desenho. Os
 * prédios são separados por componente conexo para virar uma tabela clicável.
 */

/** Camadas planas sobem um pouco para não brigarem com o chão na mesma altura. */
export const LAYERS = {
  ground: { bias: 0 },
  land: { bias: 0.3 },
  water: { bias: 0.6 },
  rail: { bias: 0.8 },
  roads: { bias: 1 },
  buildings: { bias: 0 },
};

/** Etiquetas sem geometria própria: relações, rotas e linhas que cruzam o mapa. */
const SKIP =
  /^(route|restriction|type=|boundary|power|name_|name=|barrier|height|man_made_pipeline|man_made=p)/;

/**
 * Camada de um objeto do OBJ pelo nome da etiqueta, ou null para descartar.
 *
 * @param {string} name
 * @returns {keyof typeof LAYERS | null}
 */
export function classifyObject(name) {
  if (name === 'base') return 'ground';
  if (SKIP.test(name)) return null;
  if (/^(extra_build|building|man_made_(storage|water|wastewater))/.test(name)) return 'buildings';
  if (/^highway/.test(name)) return 'roads';
  if (/^railway/.test(name)) return 'rail';
  if (/^(water|waterway)/.test(name)) return 'water';
  if (/^(natural|leisure|landuse|amenity|tourism|playground|aeroway|area)/.test(name))
    return 'land';
  return null;
}

/** Só `newmtl` e `Kd`: no OBJ de cidade o material é apenas uma cor. */
export function parseMtl(text) {
  const colors = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key === 'newmtl') current = rest.join(' ');
    else if (key === 'Kd' && current) colors[current] = rest.slice(0, 3).map(Number);
  }
  return colors;
}

/** Índice de vértice de um termo `v/vt/vn`; negativo é relativo ao fim, como manda o OBJ. */
export function faceVertex(term, vertexCount) {
  const i = Number.parseInt(term, 10);
  return i < 0 ? vertexCount + i : i - 1;
}

/** Union-find compacto: agrupa vértices ligados por faces, um grupo por prédio. */
export class Components {
  constructor() {
    this.parent = new Map();
  }

  find(a) {
    let root = a;
    while (true) {
      const p = this.parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    while (a !== root) {
      const next = this.parent.get(a);
      this.parent.set(a, root);
      a = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (!this.parent.has(ra)) this.parent.set(ra, ra);
    if (!this.parent.has(rb)) this.parent.set(rb, rb);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** Mantém a face se o centro dela está dentro da base quadrada. */
export function insideBase(xs, zs, half) {
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cz = zs.reduce((a, b) => a + b, 0) / zs.length;
  return Math.abs(cx) <= half && Math.abs(cz) <= half;
}

/** Área em planta de uma caixa, altura e andares sugeridos: a ficha do prédio. */
export function buildingRecord(box) {
  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  const height = box.maxY - box.minY;
  return {
    x: Math.round((box.minX + box.maxX) / 2),
    z: Math.round((box.minZ + box.maxZ) / 2),
    w: Math.round(width * 10) / 10,
    d: Math.round(depth * 10) / 10,
    h: Math.round(height * 10) / 10,
    floors: Math.max(1, Math.round(height / 3.2)),
  };
}
