// Faixas de pedestre nos cruzamentos do street view (fase 1 do mundo aberto,
// docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// O OSM de Pittsburg quase não desenha as faixas, então elas saem da grade da calçada (streetview.js):
//
// 1. De um ponto do meio-fio, atravessa a rua: se chega à calçada do outro lado em 4 a 20 m, é um trecho
//    de rua, com a largura dele.
// 2. Anda ao longo da rua a partir do meio desse trecho: onde a largura cresce de repente (mais de 1,7 vez),
//    começa o cruzamento.
// 3. A faixa vai 3 m antes desse ponto, de um meio-fio ao outro, com listras de 0,5 m a cada 1 m.
//
// Uma faixa por chegada ao cruzamento (as repetidas, perto e no mesmo rumo, saem). É só desenho: a rua
// inteira continua caminhável. Carros e pedestres do jogo (fase 3) podem usar as mesmas posições.
//
// PREMISSAS: faixa de 3 m, listras de 0,5 m, rua de 4 a 20 m e o salto de 1,7 vez na largura.

export const CROSSWALK = { depth: 3, stripe: 0.5, gap: 0.5, minRoad: 4, maxRoad: 20, jump: 1.7, lookAhead: 16, back: 3, cap: 40 };

/**
 * Faixas a partir da grade (\`at(x, z)\`: 1 rua, 2 ou 3 calçada, 0 fora, -1 fora da grade). Devolve o centro, o
 * rumo da travessia (\`dir\`, unitário), a largura da rua ali e a profundidade da faixa.
 */
export function findCrosswalks(grid, opt = CROSSWALK) {
  const { n, x0, z0, cell, kind, at } = grid;
  const step = cell / 2;
  // Distância pela rua a partir de (x, z) no rumo (ux, uz) até sair dela. Na borda da grade depois de mais
  // de \`maxRoad\` metros de rua, a rua segue (conta como \`cap\`): é larga naquele rumo. Antes disso, não dá
  // para saber (null).
  const run = (x, z, ux, uz) => {
    for (let d = 0; d <= opt.cap; d += step) {
      const k = at(x + ux * d, z + uz * d);
      if (k === -1) return d >= opt.maxRoad ? opt.cap : null;
      if (k !== 1) return d;
    }
    return opt.cap;
  };
  // Largura da rua em (x, z) no rumo (ux, uz): os dois lados, e o deslocamento até o meio.
  const width = (x, z, ux, uz) => {
    if (at(x, z) !== 1) return null;
    const a = run(x, z, ux, uz), b = run(x, z, -ux, -uz);
    return a === null || b === null ? null : { w: a + b, shift: (a - b) / 2 };
  };
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const seen = new Set();
  const found = [];
  for (let r = 1; r < n - 1; r++) {
    for (let c = 1; c < n - 1; c++) {
      if (kind[r * n + c] < 2) continue;
      // Rumo até a rua: a média dos vizinhos de rua.
      let dx = 0, dz = 0;
      for (const [dc, dr] of N8) if (kind[(r + dr) * n + c + dc] === 1) { dx += dc; dz += dr; }
      if (!dx && !dz) continue;
      const x = x0 + (c + 0.5) * cell, z = z0 + (r + 0.5) * cell;
      // Um ponto de partida a cada 3 m de meio-fio.
      const key = `${Math.floor(x / 3)},${Math.floor(z / 3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      // 1. Atravessa: da borda da rua até a calçada do outro lado.
      const sx = x + ux * cell, sz = z + uz * cell;
      const across = run(sx, sz, ux, uz);
      if (across === null || across < opt.minRoad || across > opt.maxRoad) continue;
      const fx = sx + ux * (across + step), fz = sz + uz * (across + step);
      if (at(fx, fz) < 2) continue;
      const mx = sx + ux * (across / 2), mz = sz + uz * (across / 2);
      const w0 = width(mx, mz, ux, uz);
      if (!w0) continue;
      // 2. Ao longo da rua, nos dois sentidos: onde a largura salta, começa o cruzamento.
      const ax = -uz, az = ux;
      for (const sgn of [1, -1]) {
        let junction = null;
        for (let s = 1; s <= opt.lookAhead; s += 0.5) {
          const w = width(mx + ax * s * sgn, mz + az * s * sgn, ux, uz);
          if (w === null) break;
          if (w.w > w0.w * opt.jump) { junction = s; break; }
        }
        if (junction === null || junction - opt.back < 0.5) continue;
        // A faixa fica num trecho de rua de verdade: atrás dela (longe do cruzamento), a rua segue por pelo
        // menos 8 m com a mesma largura. Tira a "faixa" em diagonal, de esquina a esquina, no meio do cruzamento.
        let behind = 0;
        for (let s = 0.5; s <= 8; s += 0.5) {
          const w = width(mx - ax * s * sgn, mz - az * s * sgn, ux, uz);
          if (!w || w.w > w0.w * 1.25 || w.w < w0.w * 0.75) break;
          behind = s;
        }
        if (behind < 8) continue;
        // 3. A faixa, 3 m antes, centrada na largura da rua ali.
        const s = junction - opt.back;
        let cx = mx + ax * s * sgn, cz = mz + az * s * sgn;
        const w = width(cx, cz, ux, uz);
        if (!w || w.w > opt.maxRoad) continue;
        cx += ux * w.shift;
        cz += uz * w.shift;
        // Uma por chegada: a menos de 6 m e no mesmo rumo (até 30°, sem sentido) é a mesma.
        const same = found.some((f) => Math.hypot(f.x - cx, f.z - cz) < 6 && Math.abs(f.dir[0] * ux + f.dir[1] * uz) > Math.cos(Math.PI / 6));
        if (!same) found.push({ x: cx, z: cz, dir: [ux, uz], width: w.w, depth: opt.depth });
      }
    }
  }
  return found;
}

/** Desenho: listras brancas instanciadas, rente ao asfalto. */
export function createCrosswalks(THREE, scene, max = 1500, opt = CROSSWALK) {
  const geo = new THREE.PlaneGeometry(opt.stripe, opt.depth).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stripes = new THREE.InstancedMesh(geo, mat, max);
  stripes.count = 0;
  stripes.receiveShadow = true;
  stripes.frustumCulled = false;
  stripes.visible = false;
  scene.add(stripes);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let last = [];
  let lastY = 0;
  // Com o kit de ruas (kit-ruas.js), a faixa dentro de uma peça de cruzamento não é desenhada (a peça traz a
  // dela); a lista continua inteira, para os pedestres e os semáforos.
  let skip = () => false;
  function draw() {
    let k = 0;
    for (const f of last) {
      if (skip(f)) continue;
      const [ux, uz] = f.dir;
      // A listra comprida vai no sentido da rua (o eixo z da peça); elas se repetem atravessando.
      q.setFromAxisAngle(up, Math.atan2(-uz, ux));
      const count = Math.floor((f.width - 0.6) / (opt.stripe + opt.gap));
      const start = -((count - 1) * (opt.stripe + opt.gap)) / 2;
      for (let i = 0; i < count && k < max; i++) {
        const o = start + i * (opt.stripe + opt.gap);
        // 5 cm acima do asfalto: por cima da fita do kit de ruas (2,5 cm).
        m4.compose(pos.set(f.x + ux * o, lastY + 0.05, f.z + uz * o), q, one);
        stripes.setMatrixAt(k++, m4);
      }
    }
    stripes.count = k;
    stripes.instanceMatrix.needsUpdate = true;
    stripes.visible = k > 0;
    return k;
  }
  return {
    /** Faixas que não são desenhadas: `fn(faixa)` verdadeiro pula (as do kit de ruas). */
    setSkip(fn) {
      skip = fn ?? (() => false);
      return draw();
    },
    rebuild(grid, roadY) {
      last = findCrosswalks(grid, opt);
      lastY = roadY;
      return { crosswalks: last.length, stripes: draw() };
    },
    hide() {
      stripes.visible = false;
    },
    list: () => last.map((f) => ({ ...f, dir: [...f.dir] })),
  };
}
