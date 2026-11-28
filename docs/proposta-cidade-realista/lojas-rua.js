// Loja do jogo e farmácia na rua (fase 2 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md):
// como o mercado (mercado-rua.js), cada uma num lote ao lado da calçada, com a mesma casca.
//
// - Loja do jogo: os itens de POST /v1/avatars/:id/shop em expositores (roupas 1–3 à esquerda,
//   eletrodomésticos à direita, móveis no fundo e, no meio, ferramenta de trabalho, cama e skate).
// - Farmácia: o balcão vende o remédio da doença em curso (POST /v1/avatars/:id/medicine); as doenças
//   graves vão para o hospital, como no painel.
//
// Compra é dinheiro: o primeiro E mostra o preço e pede confirmação; o segundo E (em 4 s) compra. A regra
// é a do servidor (saldo, item que já tem, doença).
//
// PREMISSAS: os lugares em Pittsburg, o tamanho (12 × 10 m) e a arrumação.

import { storeShell } from './mercado-rua.js';

const CURB = 0.15;
const REACH = 1.2;
const CONFIRM_MS = 4000;

/** Lojas da cidade: a frente (meio da porta, na borda de fora da calçada) e o rumo para dentro. */
export const STORES = {
  pittsburg: [
    { id: 'loja', kind: 'loja', label: 'Loja do jogo', sign: 'LOJA', color: 0x7a3e9d, front: [-1385.7, 4872.5], yaw: 1.885, width: 12, depth: 10 },
    { id: 'farmacia', kind: 'farmacia', label: 'Farmácia', sign: 'FARMÁCIA', color: 0x1f8a70, front: [-1402.6, 4836.5], yaw: 1.885, width: 12, depth: 10 },
  ],
};

const thaler = (cents) => (Number(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Expositores da loja do jogo (local), a partir do catálogo: o item, o rótulo, o preço e o formato. */
export function shopDisplays(cat) {
  const out = [];
  const add = (item, level, label, price, at, spot, size, color) => out.push({ item, level, label, price, at, spot, size, color });
  (cat.clothes ?? []).forEach((c, i) =>
    add('roupa', c.level, `Roupa ${c.level} (+${Math.round(c.bonus * 100)}% no turno)`, c.price, [-5.1, 2.5 + i * 2], [-3.9, 2.5 + i * 2], [0.5, 1.2, 0.5], [0x6c8ebf, 0x9b59b6, 0xe67e22][i]),
  );
  const eletro = (cat.home ?? []).filter((h) => h.kind === 'eletro');
  const movel = (cat.home ?? []).filter((h) => h.kind === 'movel');
  const eSize = { fogao: [0.7, 0.9, 0.6], geladeira: [0.7, 1.8, 0.65], micro_ondas: [0.5, 0.3, 0.4] };
  eletro.forEach((h, i) => add(h.code, undefined, h.label, h.price, [5.1, 2.5 + i * 2], [3.9, 2.5 + i * 2], eSize[h.code] ?? [0.6, 0.8, 0.6], 0xdfe3e6));
  const mSize = { sofa: [1.8, 0.8, 0.8], mesa: [1.2, 0.75, 0.8], guarda_roupa: [1.0, 1.9, 0.6] };
  movel.forEach((h, i) => add(h.code, undefined, h.label, h.price, [-3 + i * 3, 8.9], [-3 + i * 3, 7.6], mSize[h.code] ?? [1, 1, 0.6], 0x8d6e63));
  if (cat.tool) add('ferramenta', undefined, `Ferramenta de trabalho (+${Math.round(cat.tool.bonus * 100)}%, ${cat.tool.days} dias)`, cat.tool.price, [-1.6, 5], [-1.6, 3.8], [0.5, 0.5, 0.5], 0x546e7a);
  if (cat.bed) add('cama', undefined, 'Cama (libera o 2º turno de 6 h)', cat.bed.price, [0, 5], [0, 3.8], [1.4, 0.5, 2.0], 0xb0bec5);
  if (cat.skate) add('skate', undefined, `Skate (${cat.skate.trips} viagens)`, cat.skate.price, [1.6, 5], [1.6, 3.8], [0.8, 0.12, 0.25], 0xff7043);
  return out;
}

export function createStreetStores({ THREE, scene, city, groundY, servidor, streetView }) {
  const specs = STORES[city] ?? [];
  if (!specs.length) return null;

  // ---------- Aviso e confirmação ----------
  const style = document.createElement('style');
  style.textContent = `
    .lj-prompt { position: fixed; left: 50%; bottom: 110px; transform: translateX(-50%); z-index: 8; padding: 9px 16px; border-radius: 999px;
      background: rgba(15,23,42,.9); color: #fff; font: 600 14px system-ui, sans-serif; display: flex; gap: 10px; align-items: center; max-width: calc(100vw - 32px); }
    .lj-prompt[hidden] { display: none; }
    .lj-prompt kbd { background: #f59e0b; color: #0b1220; border-radius: 6px; padding: 2px 8px; font: 800 13px system-ui, sans-serif; }
    .lj-prompt button { border: 0; border-radius: 8px; padding: 5px 10px; font-weight: 700; cursor: pointer; }
    .lj-prompt.confirma { outline: 2px solid #f59e0b; }
    @media (max-width: 640px) { .lj-prompt { bottom: 440px; } }
  `;
  document.head.append(style);
  const prompt = document.createElement('div');
  prompt.className = 'lj-prompt';
  prompt.hidden = true;
  document.body.append(prompt);

  const errorText = (e) =>
    ({
      already_owned: 'O avatar já tem este item (ou um melhor).',
      insufficient_thaler: 'THALER insuficiente.',
      not_sick: 'O avatar não está com essa doença.',
      hospital_only: 'Doença grave: só o hospital trata.',
      in_hospital: 'Internado: sem loja.',
      no_session: 'Entre no jogo e pegue um avatar para comprar.',
    })[e.code] ?? e.message;

  // ---------- As lojas ----------
  const built = [];
  const matCache = new Map();
  const matOf = (hex) => {
    if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6 }));
    return matCache.get(hex);
  };
  for (const spec of specs) {
    const shell = storeShell(THREE, scene, spec, groundY + CURB, { name: `loja-${spec.id}`, sign: spec.sign, color: spec.color });
    const store = { spec, shell, points: [], solid: [] };
    const pedestal = matOf(0xe0e0e0);
    if (spec.kind === 'loja') {
      servidor
        .shopCatalog()
        .then((cat) => {
          for (const d of shopDisplays(cat)) {
            const [x, z] = d.at;
            const [w, h, dd] = d.size;
            shell.box(w + 0.2, 0.3, dd + 0.2, x, 0.15, z, pedestal);
            shell.box(w, h, dd, x, 0.3 + h / 2, z, matOf(d.color));
            store.solid.push({ x0: x - w / 2 - 0.35, x1: x + w / 2 + 0.35, z0: z - dd / 2 - 0.35, z1: z + dd / 2 + 0.35 });
            store.points.push({ ...d, kind: 'buy' });
          }
        })
        .catch(() => {});
    } else {
      // Farmácia: balcão no meio e prateleiras no fundo.
      shell.box(5, 1.0, 0.7, 0, 0.5, 6, matOf(0xffffff));
      for (const x of [-4, -1.3, 1.3, 4]) shell.box(2.2, 2.0, 0.4, x, 1.0, 9.5, matOf(0xb2dfdb));
      store.solid.push({ x0: -2.85, x1: 2.85, z0: 5.3, z1: 6.7 }, { x0: -5.5, x1: 5.5, z0: 9.0, z1: 10 });
      store.points.push({ kind: 'medicine', spot: [0, 4.8] });
    }
    store.walkable = shell.walkableWith(store.solid);
    built.push(store);
  }

  // ---------- Interação ----------
  let near = null; // { store, point }
  let armed = null; // compra esperando a confirmação: { point, at }
  let busy = false;
  const conditionNow = () => {
    const av = servidor.getData()?.avatar;
    return (av?.conditions ?? []).find((c) => !c.hospital_only) ?? (av?.conditions ?? [])[0] ?? null;
  };
  const describe = (p) => {
    if (p.kind === 'buy') return `${p.label} · ${thaler(p.price)} THALER`;
    const c = conditionNow();
    return c ? `Remédio para ${c.label} · ${thaler(servidor.medicinePrice?.() ?? 1000)} THALER` : 'Farmácia: o avatar não está doente';
  };
  const show = (msg) => {
    if (!near && !msg) {
      prompt.hidden = true;
      return;
    }
    prompt.hidden = false;
    const confirming = armed && armed.point === near?.point && performance.now() - armed.at < CONFIRM_MS;
    prompt.classList.toggle('confirma', !!confirming);
    if (msg) {
      prompt.innerHTML = `<span>${msg}</span>`;
      return;
    }
    const verb = near.point.kind === 'buy' ? 'Comprar' : 'Comprar remédio';
    prompt.innerHTML = `<kbd>E</kbd><span>${confirming ? `Confirmar: ${describe(near.point)}` : describe(near.point)}</span><button type="button">${confirming ? 'Confirmar' : verb}</button>`;
    prompt.querySelector('button').onclick = () => act();
  };
  let msgTimer = null;
  const flash = (msg) => {
    show(msg);
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => show(), 2800);
  };
  async function act() {
    if (!near || busy) return;
    const p = near.point;
    if (p.kind === 'medicine' && !conditionNow()) return flash('O avatar não está doente.');
    // 1º E: pede confirmação (é dinheiro); 2º E, em 4 s: compra.
    if (!armed || armed.point !== p || performance.now() - armed.at > CONFIRM_MS) {
      armed = { point: p, at: performance.now() };
      return show();
    }
    armed = null;
    busy = true;
    try {
      if (p.kind === 'buy') {
        const r = await servidor.avatarPost('shop', { item: p.item, ...(p.level ? { level: p.level } : {}) });
        flash(`${p.label.split(' (')[0]}: −${thaler(r.purchase.price)} THALER.`);
      } else {
        const c = conditionNow();
        const r = await servidor.avatarPost('medicine', { condition: c.code });
        flash(r.cured ? `Remédio tomado: ${c.label} curada.` : `Remédio tomado: ${c.label} ainda não passou (a cura é de 70%).`);
      }
      servidor.refresh?.();
    } catch (e) {
      flash(errorText(e));
    } finally {
      busy = false;
    }
  }
  addEventListener('keydown', (e) => {
    if (!streetView.active() || e.target.closest?.('input, textarea, select')) return;
    if (e.key.toLowerCase() === 'e' && near) act();
  });

  const update = () => {
    if (!streetView.active()) {
      if (near) {
        near = null;
        prompt.hidden = true;
      }
      return;
    }
    const pos = streetView.position();
    let best = null;
    let bestD = REACH;
    for (const s of built) {
      if (!s.shell.inside(pos.x, pos.z)) continue;
      const [lx, lz] = s.shell.toLocal(pos.x, pos.z);
      for (const p of s.points) {
        const d = Math.hypot(lx - p.spot[0], lz - p.spot[1]);
        if (d < bestD) { bestD = d; best = { store: s, point: p }; }
      }
    }
    if (best?.point !== near?.point) {
      near = best;
      if (!best) armed = null;
      show();
    }
  };

  return {
    groups: built.map((s) => s.shell.group),
    walkable: (x, z) => built.some((s) => s.walkable(x, z)),
    floorAt: (x, z) => (built.some((s) => s.walkable(x, z)) ? groundY + CURB : null),
    update,
    act,
    debug: () => ({
      stores: built.map((s) => ({ id: s.spec.id, points: s.points.map((p) => ({ kind: p.kind, item: p.item, level: p.level, spot: s.shell.toWorld(...p.spot) })), door: s.shell.toWorld(0, -1), inside: s.shell.toWorld(0, 2.5) })),
      near: near && { kind: near.point.kind, item: near.point.item },
      armed: !!armed,
    }),
  };
}
