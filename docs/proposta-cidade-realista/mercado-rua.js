// Mercado na rua (fase 2 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md):
// o Mercado da Prefeitura fica num lote ao lado da calçada, e o avatar entra pela porta sem tela de
// carregamento.
//
// - Dentro: 4 gôndolas com os alimentos do catálogo do game-core, um caixa e um balcão de lanches.
// - Na gôndola, E põe o pacote do alimento no carrinho (local). No caixa, E paga: cada pacote vai para a
//   despensa pela mesma rota do painel (POST /v1/avatars/:id/pantry). No balcão, E come na hora
//   (POST /v1/avatars/:id/meals). A regra continua no servidor (saldo, despensa cheia, tempo no mercado).
// - Peças procedurais, como o mobiliário da rua; o interior do SCC Kit (ADR-0015) entra depois.
//
// PREMISSAS: o lugar do mercado em Pittsburg, o tamanho (14 × 12 m) e a arrumação.

/** Mercados da cidade: a frente (meio da porta, na borda de fora da calçada) e o rumo para dentro. */
export const MARKETS = {
  pittsburg: [{ id: 'prefeitura', label: 'Mercado da Prefeitura', front: [-1409.1, 4860.2], yaw: 4.974, width: 14, depth: 12 }],
};
const CURB = 0.15;
const REACH = 1.4;

/** Cor do produto pelo grupo do alimento (o catálogo do Strapi), ou uma cor fixa pelo código. */
const GROUP_COLORS = { fruta: 0xd9443b, frutas: 0xd9443b, verdura: 0x4caf50, verduras: 0x4caf50, legume: 0x8bc34a, legumes: 0x8bc34a, grao: 0xe0b341, graos: 0xe0b341, cereal: 0xe0b341, proteina: 0x8d5a3b, carne: 0x8d5a3b, laticinio: 0xf2efe6, laticinios: 0xf2efe6, bebida: 0x3f7fd6, padaria: 0xc9a06b };
const colorOf = (f) => {
  const g = String(f.group ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (GROUP_COLORS[g]) return GROUP_COLORS[g];
  let h = 0;
  for (const ch of f.code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [0xd9443b, 0x4caf50, 0xe0b341, 0x8d5a3b, 0x3f7fd6, 0xc9a06b, 0x9c5bd1][h % 7];
};

const thaler = (cents) => (Number(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Arrumação do mercado em coordenadas locais (x para a direita, z para dentro, a partir do meio da porta).
 * Devolve as caixas sólidas (gôndolas, balcões), as vagas de produto e os pontos de interação.
 */
export function marketLayout(m) {
  const hw = m.width / 2;
  const gondolas = [-4.2, -1.4, 1.4, 4.2].map((x) => ({ x0: x - 0.45, x1: x + 0.45, z0: 3.5, z1: 9.5, h: 1.8 }));
  const counters = [
    { kind: 'pay', x0: 3.0, x1: 6.2, z0: 1.2, z1: 2.0, h: 1.0, spot: [4.6, 2.7] },
    { kind: 'eat', x0: -6.2, x1: -3.0, z0: 1.2, z1: 2.0, h: 1.0, spot: [-4.6, 2.7] },
  ];
  // Vagas: cada lado de cada gôndola em 3 trechos de 2 m; o ponto de pegar fica no corredor.
  const slots = [];
  for (const g of gondolas) {
    for (const side of [-1, 1]) {
      for (let s = 0; s < 3; s++) {
        const z = g.z0 + 1 + s * 2;
        const faceX = side < 0 ? g.x0 : g.x1;
        slots.push({ faceX, side, z, spot: [faceX + side * 0.55, z] });
      }
    }
  }
  return { hw, depth: m.depth, gondolas, counters, slots, door: 1.2 };
}

/**
 * Casca de uma loja na rua (mercado, loja do jogo, farmácia): chão, paredes com a porta no meio da frente,
 * telhado (segura a câmera dentro), letreiro e uma luz. Coordenadas locais: x para a direita, z para dentro,
 * a partir do meio da porta (\`spec.front\`, \`spec.yaw\`). Devolve o grupo, \`box\` (peças com colisão da câmera
 * pelas caixas do street view) e as conversões entre o mundo e o local.
 */
export function storeShell(THREE, scene, spec, floorY, { name, sign: signText, color, door = 1.2 }) {
  const [fx, fz] = spec.front;
  const cos = Math.cos(spec.yaw), sin = Math.sin(spec.yaw);
  const toLocal = (x, z) => {
    const dx = x - fx, dz = z - fz;
    return [dx * cos - dz * sin, dx * sin + dz * cos];
  };
  const toWorld = (lx, lz) => [fx + lx * cos + lz * sin, fz - lx * sin + lz * cos];
  const group = new THREE.Group();
  group.name = name;
  group.position.set(fx, floorY, fz);
  group.rotation.y = spec.yaw;
  scene.add(group);
  const H = 4.5, T = 0.2;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const box = (w, h, d, x, y, z, mat, blocker = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    if (blocker) m.userData.blocker = true;
    group.add(m);
    return m;
  };
  const W = spec.width, D = spec.depth;
  box(W, 0.05, D, 0, 0.0, D / 2, new THREE.MeshStandardMaterial({ color: 0xcfd2cc, roughness: 0.6 }));
  box(W, H, T, 0, H / 2, D, wallMat); // fundo
  box(T, H, D, -W / 2, H / 2, D / 2, wallMat);
  box(T, H, D, W / 2, H / 2, D / 2, wallMat);
  const side = (W - 2 * door) / 2;
  box(side, H, T, -(door + side / 2), H / 2, 0, wallMat); // frente, à esquerda da porta
  box(side, H, T, door + side / 2, H / 2, 0, wallMat); // frente, à direita
  box(2 * door, H - 2.4, T, 0, 2.4 + (H - 2.4) / 2, 0, wallMat); // em cima da porta
  box(W + 0.4, 0.25, D + 0.4, 0, H + 0.12, D / 2, trimMat, true); // telhado: segura a câmera dentro
  // Letreiro em cima da porta, do lado de fora.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(signText, 256, 50);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) }));
  sign.position.set(0, 3.3, -0.12);
  sign.rotation.y = Math.PI;
  group.add(sign);
  // Luz de dentro (uma só, para caber no orçamento).
  const lamp = new THREE.PointLight(0xfff4e0, 18, 16, 1.6);
  lamp.position.set(0, H - 0.6, D / 2);
  group.add(lamp);
  /** Dentro do prédio (para os pontos de interação). */
  const inside = (x, z) => {
    const [lx, lz] = toLocal(x, z);
    return Math.abs(lx) <= W / 2 && lz >= -0.2 && lz <= D;
  };
  /** Onde dá para andar: a porta liga a calçada ao salão; as caixas \`solid\` (locais) ficam de fora. */
  const walkableWith = (solid) => (x, z) => {
    const [lx, lz] = toLocal(x, z);
    if (Math.abs(lx) <= door - 0.15 && lz >= -1.6 && lz <= 0.5) return true;
    if (Math.abs(lx) > W / 2 - 0.35 || lz < 0.35 || lz > D - 0.35) return false;
    return !solid.some((b) => lx >= b.x0 && lx <= b.x1 && lz >= b.z0 && lz <= b.z1);
  };
  return { group, box, toLocal, toWorld, floorY, inside, walkableWith };
}

export function createStreetMarket({ THREE, scene, city, groundY, servidor, streetView }) {
  const spec = MARKETS[city]?.[0];
  if (!spec) return null;
  const L = marketLayout(spec);
  const shell = storeShell(THREE, scene, spec, groundY + CURB, { name: 'mercado-rua', sign: 'MERCADO', color: 0x2f6f4f, door: L.door });
  const { group, box, toLocal, floorY } = shell;
  const [fx, fz] = spec.front;
  const cos = Math.cos(spec.yaw), sin = Math.sin(spec.yaw);

  // ---------- Gôndolas, balcões e produtos ----------
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.5, metalness: 0.3 });
  for (const g of L.gondolas) box(g.x1 - g.x0, g.h, g.z1 - g.z0, (g.x0 + g.x1) / 2, g.h / 2, (g.z0 + g.z1) / 2, shelfMat);
  const counterMat = new THREE.MeshStandardMaterial({ color: 0x6b4b34, roughness: 0.7 });
  for (const c of L.counters) box(c.x1 - c.x0, c.h, c.z1 - c.z0, (c.x0 + c.x1) / 2, c.h / 2, (c.z0 + c.z1) / 2, counterMat);
  const productGeo = new THREE.BoxGeometry(0.22, 0.24, 0.28);
  const products = new THREE.InstancedMesh(productGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), L.slots.length * 3 * 6);
  products.count = 0;
  group.add(products);

  let foods = [];
  const slotFood = []; // alimento de cada vaga
  const fillShelves = () => {
    if (!foods.length) return;
    const m4 = new THREE.Matrix4();
    const color = new THREE.Color();
    let k = 0;
    L.slots.forEach((s, i) => {
      const f = foods[i % foods.length];
      slotFood[i] = f;
      color.setHex(colorOf(f));
      for (let level = 0; level < 3; level++) {
        for (let j = 0; j < 6; j++) {
          m4.makeTranslation(s.faceX + s.side * 0.14, 0.35 + level * 0.55, s.z - 0.8 + j * 0.32);
          products.setMatrixAt(k, m4);
          products.setColorAt(k++, color);
        }
      }
    });
    products.count = k;
    products.instanceMatrix.needsUpdate = true;
    if (products.instanceColor) products.instanceColor.needsUpdate = true;
  };
  servidor
    .foodCatalog()
    .then((list) => {
      foods = list;
      fillShelves();
    })
    .catch(() => {});

  // ---------- Onde dá para andar ----------
  const solid = [...L.gondolas, ...L.counters].map((b) => ({ x0: b.x0 - 0.25, x1: b.x1 + 0.25, z0: b.z0 - 0.25, z1: b.z1 + 0.25 }));
  const walkable = (x, z) => {
    const [lx, lz] = toLocal(x, z);
    // A porta liga a calçada ao salão.
    if (Math.abs(lx) <= L.door - 0.15 && lz >= -1.6 && lz <= 0.5) return true;
    if (Math.abs(lx) > L.hw - 0.35 || lz < 0.35 || lz > L.depth - 0.35) return false;
    return !solid.some((b) => lx >= b.x0 && lx <= b.x1 && lz >= b.z0 && lz <= b.z1);
  };
  const inside = (x, z) => {
    const [lx, lz] = toLocal(x, z);
    return Math.abs(lx) <= L.hw && lz >= -0.2 && lz <= L.depth;
  };

  // ---------- Interação: aviso, carrinho e a tecla E ----------
  const style = document.createElement('style');
  style.textContent = `
    .mk-prompt { position: fixed; left: 50%; bottom: 110px; transform: translateX(-50%); z-index: 8; padding: 9px 16px; border-radius: 999px;
      background: rgba(15,23,42,.88); color: #fff; font: 600 14px system-ui, sans-serif; display: flex; gap: 10px; align-items: center; }
    .mk-prompt[hidden], .mk-cart[hidden] { display: none; }
    .mk-prompt kbd { background: #f59e0b; color: #0b1220; border-radius: 6px; padding: 2px 8px; font: 800 13px system-ui, sans-serif; }
    .mk-prompt button { border: 0; border-radius: 8px; padding: 5px 10px; font-weight: 700; cursor: pointer; }
    .mk-cart { position: fixed; left: 16px; bottom: 16px; z-index: 8; max-width: 300px; padding: 10px 12px; border-radius: 12px;
      background: rgba(15,23,42,.88); color: #fff; font: 13px system-ui, sans-serif; }
    .mk-cart h4 { margin: 0 0 6px; font-size: 14px; }
    .mk-cart ul { margin: 0 0 6px; padding-left: 18px; }
    @media (max-width: 640px) { .mk-prompt { bottom: 440px; } .mk-cart { bottom: 440px; } }
  `;
  document.head.append(style);
  const prompt = document.createElement('div');
  prompt.className = 'mk-prompt';
  prompt.hidden = true;
  document.body.append(prompt);
  const cartBox = document.createElement('div');
  cartBox.className = 'mk-cart';
  cartBox.hidden = true;
  document.body.append(cartBox);

  const cart = [];
  let near = null;
  let busy = false;
  let snackIndex = 0;
  const renderCart = (msg = '') => {
    const total = cart.reduce((s, c) => s + Number(c.price), 0);
    cartBox.hidden = !cart.length && !msg;
    cartBox.innerHTML = `<h4>🛒 Carrinho${cart.length ? ` · ${thaler(total)} THALER` : ''}</h4>${
      cart.length ? `<ul>${cart.map((c) => `<li>${c.label} (pacote de ${c.units})</li>`).join('')}</ul><div>Pague no caixa, à direita da porta.</div>` : ''
    }${msg ? `<div style="margin-top:6px">${msg}</div>` : ''}`;
  };
  const actionText = (n) => {
    if (n.kind === 'shelf') return `Pegar ${n.food.label} · pacote de ${n.food.pack} · ${thaler(n.food.pack_price)}`;
    if (n.kind === 'pay') return cart.length ? `Pagar ${cart.length} item(ns) · ${thaler(cart.reduce((s, c) => s + Number(c.price), 0))}` : 'Caixa: o carrinho está vazio';
    const f = foods[snackIndex % Math.max(1, foods.length)];
    return f ? `Comer ${f.label} agora · ${thaler(f.price)} (Q troca)` : 'Balcão de lanches';
  };
  const showPrompt = () => {
    if (!near) {
      prompt.hidden = true;
      return;
    }
    prompt.hidden = false;
    prompt.innerHTML = `<kbd>E</kbd><span>${actionText(near)}</span><button type="button">${near.kind === 'shelf' ? 'Pegar' : near.kind === 'pay' ? 'Pagar' : 'Comer'}</button>`;
    prompt.querySelector('button').onclick = () => act();
  };
  const errorText = (e) =>
    ({
      pantry_full: 'A despensa está cheia (moradia e geladeira aumentam).',
      insufficient_thaler: 'THALER insuficiente.',
      not_hungry: 'O avatar está satisfeito.',
      in_hospital: 'Internado: sem mercado.',
      no_session: 'Entre no jogo e pegue um avatar para comprar.',
    })[e.code] ?? e.message;

  async function act() {
    if (!near || busy) return;
    if (near.kind === 'shelf') {
      cart.push({ food: near.food.code, label: near.food.label, units: near.food.pack, price: near.food.pack_price });
      renderCart();
      showPrompt();
      return;
    }
    if (near.kind === 'pay') {
      if (!cart.length) return;
      busy = true;
      let paid = 0;
      let msg = '';
      try {
        while (cart.length) {
          await servidor.buyFood('pack', cart[0].food);
          cart.shift();
          paid++;
        }
        msg = `Pago: ${paid} pacote(s) na despensa.`;
      } catch (e) {
        msg = `${paid ? `Pago: ${paid}. ` : ''}Parou: ${errorText(e)}`;
      } finally {
        busy = false;
        renderCart(msg);
        showPrompt();
        servidor.refresh?.();
      }
      return;
    }
    const f = foods[snackIndex % Math.max(1, foods.length)];
    if (!f) return;
    busy = true;
    try {
      const r = await servidor.buyFood('meal', f.code);
      renderCart(`${f.label}: alimentação ${r.avatar.attributes.food}/10.`);
    } catch (e) {
      renderCart(errorText(e));
    } finally {
      busy = false;
      servidor.refresh?.();
    }
  }
  addEventListener('keydown', (e) => {
    if (!streetView.active() || e.target.closest?.('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'e' && near) act();
    if (k === 'q' && near?.kind === 'eat' && foods.length) {
      snackIndex = (snackIndex + 1) % foods.length;
      showPrompt();
    }
  });

  /** A cada quadro: o ponto de interação mais perto do avatar, a até 1,4 m. */
  const update = () => {
    if (!streetView.active()) {
      if (near || !prompt.hidden) {
        near = null;
        prompt.hidden = true;
      }
      cartBox.hidden = true;
      return;
    }
    const p = streetView.position();
    const [lx, lz] = toLocal(p.x, p.z);
    let best = null;
    let bestD = REACH;
    if (inside(p.x, p.z)) {
      L.slots.forEach((s, i) => {
        const d = Math.hypot(lx - s.spot[0], lz - s.spot[1]);
        if (d < bestD && slotFood[i]) { bestD = d; best = { kind: 'shelf', food: slotFood[i], i }; }
      });
      for (const c of L.counters) {
        const d = Math.hypot(lx - c.spot[0], lz - c.spot[1]);
        if (d < bestD) { bestD = d; best = { kind: c.kind }; }
      }
    }
    const changed = best?.kind !== near?.kind || best?.i !== near?.i;
    near = best;
    if (changed) showPrompt();
    if (cart.length && cartBox.hidden) renderCart();
  };

  return {
    group,
    walkable,
    floorAt: (x, z) => (walkable(x, z) ? floorY : null),
    inside,
    update,
    spec,
    /** Para testes: o carrinho, o ponto mais perto e as vagas em coordenadas do mundo. */
    debug: () => ({
      cart: cart.map((c) => ({ ...c })),
      near: near && { kind: near.kind, food: near.food?.code },
      foods: foods.length,
      toWorld: (lx, lz) => [fx + lx * cos + lz * sin, fz - lx * sin + lz * cos],
      slots: L.slots.map((s) => s.spot),
      counters: L.counters.map((c) => ({ kind: c.kind, spot: c.spot })),
    }),
    act,
  };
}
