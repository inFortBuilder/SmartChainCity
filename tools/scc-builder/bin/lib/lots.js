/**
 * Lotes poligonais a partir de uma cidade real (doc 13 §3, E1.8).
 *
 * Cada lote nasce de um sítio: um prédio ou um ponto livre. O polígono é
 * estrelado: raios saem do centro e param na rua, na água ou na fronteira com
 * o vizinho. A fronteira é a de um Voronoi em que o prédio maior pesa mais. As
 * células são convexas, disjuntas e contêm o centro, então dois lotes não se
 * sobrepõem.
 */

/** Pontos de cada polígono: tamanho fixo para caber num binário simples. */
export const LOT_POINTS = 16;

/** Passo da marcha do raio, em metros. */
const RAY_STEP = 2;

/** Zonas do doc 13 §3. Os números são os do `validate-lot` e do protótipo. */
export const ZONES = [
  {
    key: 'residential',
    label: 'Residencial',
    max_height_m: 15,
    far: 1.4,
    setback_m: 4,
    price: 2.6,
  },
  { key: 'mixed', label: 'Uso misto', max_height_m: 60, far: 3.5, setback_m: 3, price: 5.2 },
  {
    key: 'commercial',
    label: 'Comercial central',
    max_height_m: 160,
    far: 6,
    setback_m: 3,
    price: 9.5,
  },
];

/**
 * Zona pelo porte do prédio: o OBJ não traz o uso, então a forma é o sinal
 * disponível. Lote vazio é residencial até o urbanismo dizer o contrário.
 */
export function zoneOf(site) {
  if (site.vacant) return 0;
  if (site.h >= 40) return 2;
  if (site.h >= 20 || site.r >= 40) return 1;
  return 0;
}

/** Mapa de bits do que um lote não pode cruzar. */
export class Raster {
  constructor(half, cell = 4) {
    this.half = half;
    this.cell = cell;
    this.size = Math.ceil((half * 2) / cell);
    this.bits = new Uint8Array(Math.ceil((this.size * this.size) / 8));
  }

  #index(x, z) {
    const cx = Math.floor((x + this.half) / this.cell);
    const cz = Math.floor((z + this.half) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return -1;
    return cz * this.size + cx;
  }

  /** Fora da base conta como bloqueado: lote não sai do mapa. */
  blocked(x, z) {
    const i = this.#index(x, z);
    if (i < 0) return true;
    return (this.bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  mark(x, z) {
    const i = this.#index(x, z);
    if (i >= 0) this.bits[i >> 3] |= 1 << (i & 7);
  }

  /** Preenche um triângulo, varrendo as células da caixa dele. */
  fillTriangle(ax, az, bx, bz, cx, cz) {
    const step = this.cell;
    const minX = Math.min(ax, bx, cx);
    const maxX = Math.max(ax, bx, cx);
    const minZ = Math.min(az, bz, cz);
    const maxZ = Math.max(az, bz, cz);
    const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);

    // Fita fina demais cairia entre as células: marca os vértices.
    this.mark(ax, az);
    this.mark(bx, bz);
    this.mark(cx, cz);
    if (area === 0) return;

    for (let z = Math.floor(minZ / step) * step + step / 2; z <= maxZ; z += step) {
      for (let x = Math.floor(minX / step) * step + step / 2; x <= maxX; x += step) {
        const w0 = ((bx - x) * (cz - z) - (bz - z) * (cx - x)) / area;
        const w1 = ((cx - x) * (az - z) - (cz - z) * (ax - x)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) this.mark(x, z);
      }
    }
  }
}

/** Grade espacial de sítios; o sítio grande entra em todas as células que cobre. */
export class SiteGrid {
  constructor(cell = 150) {
    this.cell = cell;
    this.cells = new Map();
  }

  #each(site, reach, fn) {
    const r = site.r + reach;
    const x0 = Math.floor((site.x - r) / this.cell);
    const x1 = Math.floor((site.x + r) / this.cell);
    const z0 = Math.floor((site.z - r) / this.cell);
    const z1 = Math.floor((site.z + r) / this.cell);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) fn(`${x},${z}`);
    }
  }

  add(site, reach) {
    this.#each(site, reach, (key) => {
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(site);
    });
  }

  neighbors(site, reach) {
    const found = new Set();
    this.#each(site, reach, (key) => {
      for (const other of this.cells.get(key) ?? []) {
        if (other !== site) found.add(other);
      }
    });
    return found;
  }
}

/** A fronteira fica entre 15% e 85% da distância entre os centros. */
const MIN_SHARE = 0.15;

/**
 * Fração da distância entre os centros que cabe ao sítio `a` (posição da
 * fronteira de potência). O limite é o que garante lotes disjuntos: sem ele, um
 * conjunto grande engoliria o centro da casa ao lado, o raio dela sairia da
 * própria célula e os dois lotes se sobreporiam. É simétrico: a + b = 1.
 */
export function boundaryShare(a, b, distanceSq) {
  const share = 0.5 + (a.r * a.r - b.r * b.r) / (2 * distanceSq);
  return Math.min(1 - MIN_SHARE, Math.max(MIN_SHARE, share));
}

/** Até onde o raio pode ir: cada vizinho dá um semiplano que contém o centro do sítio. */
export function powerLimit(a, dx, dz, neighbors, limit) {
  let t = limit;
  for (const b of neighbors) {
    const ox = b.x - a.x;
    const oz = b.z - a.z;
    const slope = 2 * (dx * ox + dz * oz);
    if (slope <= 0) continue;
    const distanceSq = ox * ox + oz * oz;
    const cut = (2 * boundaryShare(a, b, distanceSq) * distanceSq) / slope;
    if (cut < t) t = cut;
  }
  return t;
}

/** Polígono do lote: LOT_POINTS pares [x, z] em sentido fixo. */
export function lotPolygon(site, neighbors, raster, margin) {
  const polygon = [];
  const limit = site.r + margin;
  for (let i = 0; i < LOT_POINTS; i++) {
    const angle = (i / LOT_POINTS) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const reach = powerLimit(site, dx, dz, neighbors, limit);

    // Dentro da pegada do prédio o raster não barra: a rua só conta do muro para fora.
    let t = Math.min(site.vacant ? RAY_STEP : site.r * 0.5, reach);
    while (
      t < reach &&
      !raster.blocked(site.x + dx * (t + RAY_STEP), site.z + dz * (t + RAY_STEP))
    ) {
      t += RAY_STEP;
    }
    // Sem este limite, o último passo atravessa a fronteira e invade o vizinho.
    t = Math.min(t, reach);
    polygon.push([site.x + dx * t, site.z + dz * t]);
  }
  return polygon;
}

/** Área de um polígono simples. */
export function polygonArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/** Ponto dentro de polígono (ray casting). */
export function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[i];
    const [bx, bz] = polygon[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** Preço primário: m² × preço da zona (doc 13 §3). Em SCITY, arredondado. */
export function lotPrice(area, zone) {
  return Math.round(area * ZONES[zone].price);
}

/**
 * Pontos livres para lotes vazios: malha em que o terreno está livre, longe dos
 * prédios e perto de uma rua. Sem rua por perto seria um lote sem acesso.
 */
export function vacantSites(extent, spacing, raster, buildingGrid, options) {
  const { radius, roadReach } = options;
  const sites = [];
  const probe = { r: radius };
  for (let z = extent.minZ; z <= extent.maxZ; z += spacing) {
    for (let x = extent.minX; x <= extent.maxX; x += spacing) {
      if (raster.blocked(x, z)) continue;
      probe.x = x;
      probe.z = z;
      let near = false;
      for (const b of buildingGrid.neighbors(probe, radius)) {
        if (Math.hypot(b.x - x, b.z - z) < b.r + radius) {
          near = true;
          break;
        }
      }
      if (near) continue;
      let road = false;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        for (let t = radius; t <= roadReach && !road; t += 8) {
          road = raster.blocked(x + dx * t, z + dz * t);
        }
      }
      if (road) sites.push({ x, z, r: radius, h: 0, vacant: true });
    }
  }
  return sites;
}
