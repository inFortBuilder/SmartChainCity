// Mobiliário urbano do street view (fase 1 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md):
// postes de luz no meio-fio e árvores no lado de dentro da calçada, em volta do avatar.
//
// - A posição sai da grade da calçada (streetview.js): um poste a cada ~24 m de meio-fio e uma
//   árvore a cada ~11 m, escolhidos por um sorteio fixo pela posição no mundo. Refazer a grade não
//   muda o que já estava no lugar.
// - Peças procedurais e instanciadas (5 malhas no total), sem arquivo externo. Um GLB CC0 (Kenney,
//   Quaternius, Poly Haven) entra no lugar quando o SCC Kit tiver a peça.
// - Poste e árvore ocupam a célula da calçada: o avatar contorna (o chão ali deixa de ser andável).
// - À noite, a luminária acende (emissiva); não há luz real por poste, para caber no orçamento.
//
// PREMISSAS: espaçamento de 24 m (postes) e 11 m (árvores), poste de 6 m e árvore de 4,5 m.

export const FURNITURE = { postEvery: 24, treeEvery: 11, postHeight: 6, armLength: 1.6, treeMinDist: 2 };

/** Sorteio fixo de 0 a 1 por célula inteira do mundo (o mesmo ponto sempre dá o mesmo número). */
export const cellHash = (ix, iz) => {
  let h = (Math.imul(ix | 0, 73856093) ^ Math.imul(iz | 0, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Escolhe onde vão os postes e as árvores na grade da calçada (\`kind\`: 1 rua, 2 calçada; \`dist\` em
 * células até a rua). Um por quadrado do mundo de \`postEvery\` ou \`treeEvery\` metros: o candidato com o
 * menor sorteio. Devolve as posições e, para o poste, o rumo do braço (para o lado da rua).
 */
export function placeFurniture(grid, opt = FURNITURE) {
  const { n, x0, z0, cell, kind, dist } = grid;
  const posts = new Map();
  const trees = new Map();
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let r = 1; r < n - 1; r++) {
    for (let c = 1; c < n - 1; c++) {
      const k = r * n + c;
      if (kind[k] !== 2) continue;
      const x = x0 + (c + 0.5) * cell, z = z0 + (r + 0.5) * cell;
      const wx = Math.round(x / cell), wz = Math.round(z / cell);
      // Poste: no meio-fio (vizinho de rua), virado para a rua.
      let toRoad = null;
      for (const [dc, dr] of N8) if (kind[(r + dr) * n + c + dc] === 1) { toRoad = Math.atan2(dc, dr); break; }
      if (toRoad !== null) {
        const key = `${Math.floor(x / opt.postEvery)},${Math.floor(z / opt.postEvery)}`;
        const h = cellHash(wx, wz);
        const cur = posts.get(key);
        if (!cur || h < cur.h) posts.set(key, { x, z, h, yaw: toRoad, k });
        continue;
      }
      // Árvore: no lado de dentro da calçada, longe do meio-fio.
      if (dist[k] * cell >= opt.treeMinDist) {
        const key = `${Math.floor(x / opt.treeEvery)},${Math.floor(z / opt.treeEvery)}`;
        const h = cellHash(wx + 7919, wz - 104729);
        const cur = trees.get(key);
        if (!cur || h < cur.h) trees.set(key, { x, z, h, k, s: 0.85 + cellHash(wz, wx) * 0.35 });
      }
    }
  }
  return { posts: [...posts.values()], trees: [...trees.values()] };
}

export function createFurniture(THREE, scene, max = 1200) {
  const H = FURNITURE.postHeight;
  const metal = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.55, metalness: 0.6 });
  const lampOff = new THREE.Color(0xd9d4c4);
  const lampOn = new THREE.Color(0xffd58a);
  const lamp = new THREE.MeshStandardMaterial({ color: 0xf5f0e0, emissive: 0x000000, roughness: 0.4 });
  const bark = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: 0x4f7f38, roughness: 0.9, flatShading: true });
  const geo = {
    pole: new THREE.CylinderGeometry(0.07, 0.1, H, 8).translate(0, H / 2, 0),
    arm: new THREE.BoxGeometry(0.08, 0.08, FURNITURE.armLength).translate(0, H - 0.1, FURNITURE.armLength / 2),
    head: new THREE.BoxGeometry(0.28, 0.12, 0.55).translate(0, H - 0.2, FURNITURE.armLength),
    trunk: new THREE.CylinderGeometry(0.12, 0.18, 2.4, 7).translate(0, 1.2, 0),
    crown: new THREE.IcosahedronGeometry(1.6, 1).translate(0, 3.3, 0),
  };
  const mesh = (g, m) => {
    const im = new THREE.InstancedMesh(g, m, max);
    im.count = 0;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.visible = false;
    scene.add(im);
    return im;
  };
  const parts = { pole: mesh(geo.pole, metal), arm: mesh(geo.arm, metal), head: mesh(geo.head, lamp), trunk: mesh(geo.trunk, bark), crown: mesh(geo.crown, leaves) };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let last = { posts: [], trees: [] };

  return {
    /** Refaz as peças a partir da grade da calçada; marca as células ocupadas como não andáveis (3). */
    rebuild(grid, floorY) {
      last = placeFurniture(grid);
      const posts = last.posts.slice(0, max);
      const trees = last.trees.slice(0, max);
      posts.forEach((p, i) => {
        q.setFromAxisAngle(up, p.yaw);
        m4.compose(pos.set(p.x, floorY, p.z), q, scl.set(1, 1, 1));
        parts.pole.setMatrixAt(i, m4);
        parts.arm.setMatrixAt(i, m4);
        parts.head.setMatrixAt(i, m4);
        grid.kind[p.k] = 3;
      });
      trees.forEach((t, i) => {
        q.setFromAxisAngle(up, t.h * Math.PI * 2);
        m4.compose(pos.set(t.x, floorY, t.z), q, scl.set(t.s, t.s, t.s));
        parts.trunk.setMatrixAt(i, m4);
        parts.crown.setMatrixAt(i, m4);
        grid.kind[t.k] = 3;
      });
      for (const k of ['pole', 'arm', 'head']) parts[k].count = posts.length;
      for (const k of ['trunk', 'crown']) parts[k].count = trees.length;
      for (const p of Object.values(parts)) {
        p.instanceMatrix.needsUpdate = true;
        p.visible = true;
      }
      return { posts: posts.length, trees: trees.length };
    },
    hide() {
      for (const p of Object.values(parts)) p.visible = false;
    },
    /** À noite, a luminária acende. */
    setNight(on) {
      lamp.color.copy(on ? lampOn : lampOff);
      lamp.emissive.copy(on ? lampOn : new THREE.Color(0));
      lamp.emissiveIntensity = on ? 2.2 : 0;
    },
    counts: () => ({ posts: parts.pole.count, trees: parts.trunk.count }),
  };
}
