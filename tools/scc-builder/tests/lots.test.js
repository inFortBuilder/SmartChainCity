import { describe, expect, it } from 'vitest';

import {
  LOT_POINTS,
  Raster,
  SiteGrid,
  ZONES,
  boundaryShare,
  lotPolygon,
  lotPrice,
  pointInPolygon,
  polygonArea,
  powerLimit,
  vacantSites,
  zoneOf,
} from '../bin/lib/lots.js';

const free = () => new Raster(1000, 4);

describe('Raster', () => {
  it('marca o triângulo e deixa o resto livre', () => {
    const r = free();
    r.fillTriangle(0, 0, 100, 0, 0, 100);
    expect(r.blocked(20, 20)).toBe(true);
    expect(r.blocked(90, 90)).toBe(false);
  });

  it('fora da base é bloqueado', () => {
    expect(free().blocked(2000, 0)).toBe(true);
  });

  it('não perde uma fita mais fina que a célula', () => {
    const r = free();
    r.fillTriangle(0, 0, 100, 0, 100, 1);
    expect(r.blocked(0, 0)).toBe(true);
    expect(r.blocked(100, 0)).toBe(true);
  });
});

describe('powerLimit', () => {
  it('corta no meio entre dois sítios iguais', () => {
    const a = { x: 0, z: 0, r: 10 };
    const b = { x: 100, z: 0, r: 10 };
    expect(powerLimit(a, 1, 0, [b], 500)).toBeCloseTo(50, 6);
  });

  it('o prédio maior empurra a fronteira', () => {
    const small = { x: 0, z: 0, r: 5 };
    const big = { x: 100, z: 0, r: 40 };
    expect(powerLimit(small, 1, 0, [big], 500)).toBeLessThan(50);
    expect(powerLimit(big, -1, 0, [small], 500)).toBeGreaterThan(50);
  });

  it('vizinho atrás do raio não corta', () => {
    expect(powerLimit({ x: 0, z: 0, r: 5 }, 1, 0, [{ x: -50, z: 0, r: 5 }], 30)).toBe(30);
  });
});

describe('lotPolygon', () => {
  const site = { x: 0, z: 0, r: 10, h: 8 };

  it('sem obstáculo, vai até a margem', () => {
    const polygon = lotPolygon(site, new Set(), free(), 12);
    expect(polygon).toHaveLength(LOT_POINTS);
    const reach = polygon.map(([x, z]) => Math.hypot(x, z));
    expect(Math.max(...reach)).toBeCloseTo(22, 0);
  });

  it('para na rua', () => {
    const raster = free();
    for (let z = -100; z <= 100; z += 4) raster.mark(20, z);
    const polygon = lotPolygon(site, new Set(), raster, 40);
    for (const [x] of polygon) expect(x).toBeLessThan(20);
    expect(Math.min(...polygon.map((p) => p[0]))).toBeLessThan(-40);
  });

  it('lotes vizinhos não se sobrepõem', () => {
    const raster = free();
    const sites = [
      { x: 0, z: 0, r: 10, h: 8 },
      { x: 30, z: 5, r: 8, h: 8 },
      { x: -15, z: 28, r: 15, h: 8 },
      { x: 25, z: -35, r: 6, h: 8 },
      { x: -30, z: -20, r: 12, h: 8 },
    ];
    const grid = new SiteGrid();
    for (const s of sites) grid.add(s, 20);
    const polygons = sites.map((s) => lotPolygon(s, grid.neighbors(s, 20), raster, 20));

    for (let x = -80; x <= 80; x += 3) {
      for (let z = -80; z <= 80; z += 3) {
        const owners = polygons.filter((p) => pointInPolygon(x, z, p));
        expect(owners.length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('conjunto grande ao lado de casa pequena', () => {
  const big = { x: 0, z: 0, r: 300, h: 20 };
  const house = { x: 60, z: 0, r: 8, h: 6 };

  it('a fronteira nunca passa do centro da casa', () => {
    const share = boundaryShare(big, house, 3600);
    expect(share).toBeLessThan(1);
    expect(share + boundaryShare(house, big, 3600)).toBeCloseTo(1, 9);
    expect(powerLimit(house, -1, 0, [big], 500)).toBeGreaterThan(0);
  });

  it('os dois lotes não se sobrepõem', () => {
    const raster = free();
    const grid = new SiteGrid();
    for (const s of [big, house]) grid.add(s, 12);
    const a = lotPolygon(big, grid.neighbors(big, 12), raster, 12);
    const b = lotPolygon(house, grid.neighbors(house, 12), raster, 12);
    expect(polygonArea(b)).toBeGreaterThan(0);
    for (let x = -60; x <= 120; x += 2) {
      for (let z = -60; z <= 60; z += 2) {
        expect(pointInPolygon(x, z, a) && pointInPolygon(x, z, b)).toBe(false);
      }
    }
  });
});

describe('área e preço', () => {
  it('calcula a área do quadrado', () => {
    expect(
      polygonArea([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ])
    ).toBe(100);
  });

  it('segue o preço por m² calibrado no simulador', () => {
    expect(lotPrice(100, 0)).toBe(78);
    expect(lotPrice(100, 1)).toBe(156);
    expect(lotPrice(100, 2)).toBe(285);
  });
});

describe('zoneOf', () => {
  it('classifica pelo porte', () => {
    expect(ZONES[zoneOf({ h: 8, r: 10 })].key).toBe('residential');
    expect(ZONES[zoneOf({ h: 25, r: 10 })].key).toBe('mixed');
    expect(ZONES[zoneOf({ h: 8, r: 60 })].key).toBe('mixed');
    expect(ZONES[zoneOf({ h: 80, r: 30 })].key).toBe('commercial');
    expect(ZONES[zoneOf({ vacant: true, h: 0, r: 15 })].key).toBe('residential');
  });
});

describe('vacantSites', () => {
  const options = { radius: 15, roadReach: 60 };
  const extent = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };

  it('só nasce perto de rua e longe de prédio', () => {
    const raster = free();
    for (let x = -200; x <= 200; x += 4) raster.mark(x, 0);
    const grid = new SiteGrid();
    const building = { x: 0, z: 40, r: 20, h: 8 };
    grid.add(building, 15);

    const sites = vacantSites(extent, 40, raster, grid, options);
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      expect(s.vacant).toBe(true);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(60);
      expect(Math.hypot(s.x - building.x, s.z - building.z)).toBeGreaterThanOrEqual(35);
    }
  });

  it('sem rua por perto não há lote', () => {
    expect(vacantSites(extent, 40, free(), new SiteGrid(), options)).toEqual([]);
  });
});
