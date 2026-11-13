import type { City, Lot } from '../src/domain/lots.js';

/**
 * Cidade de teste: 3 bairros de 10 lotes de 100 m² em uso misto (US$ 1,56/m²),
 * o primeiro aberto, e o lote 9 da Prefeitura.
 */
export const testCity = (code: string): City => ({
  code,
  name: 'Cidade de Teste',
  zones: [
    { key: 'residential', label: 'Residencial', usdPerM2: 0.78, maxHeightM: 15, far: 1.4, setbackM: 4 },
    { key: 'mixed', label: 'Uso misto', usdPerM2: 1.56, maxHeightM: 60, far: 3.5, setbackM: 3 },
  ],
  openCount: 1,
  districtCount: 3,
  releaseThreshold: 0.7,
});

export const testLots = (): Pick<Lot, 'id' | 'district' | 'zone' | 'areaM2' | 'status'>[] =>
  Array.from({ length: 30 }, (_, id) => ({
    id,
    district: Math.floor(id / 10),
    zone: 'mixed',
    areaM2: 100,
    status: id === 9 ? 'civic' : 'vacant',
  }));

/** Código único por rodada: no Postgres compartilhado, cada teste tem a sua cidade. */
export const uniqueCode = () => `t-${Math.random().toString(36).slice(2, 10)}`;
