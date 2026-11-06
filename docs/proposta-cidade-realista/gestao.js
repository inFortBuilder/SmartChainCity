// Área de gestão do jogador no mapa: carteira, compra de lote, abertura de
// negócio, obra, lucro e coleta. Tudo simulado no navegador e salvo no
// localStorage; no jogo, quem decide saldo e posse é o servidor (ADR-0002).
import { BUSINESSES, DAY_MS, businessState, byKey, eligibility, netPerDay, paybackDays } from './negocios.js';

const STORAGE_KEY = 'scc-gestao-pittsburg-v1';
const SPEEDS = [
  { value: 1, label: 'Tempo real' },
  { value: 60, label: '1 h por minuto' },
  { value: 1440, label: '1 dia por minuto' },
];
const MINE_COLOR = 0x22d3ee;

const fresh = () => ({
  player: { name: 'Você', rarity: 'Comum', profession: 'Padeiro' },
  scity: 5000,
  thaler: 20000,
  gameMs: 0,
  speed: 1440,
  lots: [],
  businesses: {},
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.lots)) return { ...fresh(), ...saved };
  } catch {
    // modo privado ou dado corrompido: começa do zero
  }
  return fresh();
}

const save = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sem armazenamento: a sessão funciona, só não persiste
  }
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param {object} api ganchos da página: THREE, scene, camera, controls, getLots,
 *   lotRing, lotAt, showLot, currentLot, fmt
 */
export function createGestao(api) {
  const { THREE, scene, camera, controls, fmt } = api;
  let state = load();
  const lotsData = () => api.getLots();

  // ─ Informações do lote ─
  const lotId = (i) => `PIT-${String(i + 1).padStart(6, '0')}`;
  const zoneOf = (i) => lotsData().zonas[lotsData().zones[i]];
  const priceOf = (i) => Math.round(lotsData().areas[i] * zoneOf(i).price);
  const owns = (i) => state.lots.includes(i);
  const bairroOf = (i) => (lotsData().district ? lotsData().district[i] : 0);
  const centroid = (ring) => [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ];

  // ─ 3D: lote seu em ciano e o negócio como bloco ─
  const group = new THREE.Group();
  scene.add(group);
  const meshes = new Map();

  function draw(i) {
    const old = meshes.get(i);
    if (old) {
      group.remove(old.lot, old.box);
      old.lot.geometry.dispose();
      old.box?.geometry.dispose();
    }
    const ring = api.lotRing(i);
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const lotMesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: MINE_COLOR, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    lotMesh.position.y = 3.6;
    lotMesh.frustumCulled = false;
    group.add(lotMesh);

    let box = null;
    const business = state.businesses[i];
    if (business) {
      const biz = byKey(business.key);
      const xs = ring.map((p) => p[0]);
      const zs = ring.map((p) => p[1]);
      const w = Math.max(8, (Math.max(...xs) - Math.min(...xs)) * 0.5);
      const d = Math.max(8, (Math.max(...zs) - Math.min(...zs)) * 0.5);
      box = new THREE.Mesh(
        new THREE.BoxGeometry(w, biz.height, d).translate(0, biz.height / 2, 0),
        new THREE.MeshStandardMaterial({ color: biz.color, roughness: 0.7, transparent: true }),
      );
      const [cx, cz] = centroid(ring);
      box.position.set(cx, 3.6, cz);
      group.add(box);
    }
    meshes.set(i, { lot: lotMesh, box });
    paint(i);
  }

  // Em obra o bloco sobe e fica cinza translúcido; aberto, ganha a cor do negócio.
  function paint(i) {
    const m = meshes.get(i);
    const business = state.businesses[i];
    if (!m?.box || !business) return;
    const s = businessState(business, state.gameMs);
    m.box.scale.y = Math.max(0.05, s.progress);
    m.box.material.opacity = s.phase === 'obra' ? 0.55 : 1;
    m.box.material.color.set(s.phase === 'obra' ? 0x9ca3af : byKey(business.key).color);
  }

  // ─ HUD na barra superior ─
  const hud = document.createElement('div');
  hud.className = 'hud';
  document.querySelector('.topbar').append(hud);
  hud.innerHTML = `
    <span class="chip" title="Seu avatar">👤 ${esc(state.player.name)} · ${esc(state.player.rarity)} · ${esc(state.player.profession)}</span>
    <span class="chip" data-hud-local>📍 —</span>
    <span class="chip chip--scity" data-hud-scity></span>
    <span class="chip chip--thaler" data-hud-thaler></span>
    <select class="chip" data-hud-speed aria-label="Velocidade do tempo">
      ${SPEEDS.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}
    </select>
    <button class="btn btn--blue" type="button" data-hud-patrimonio>Meu patrimônio</button>
    <button class="btn btn--ghost" type="button" data-hud-reset title="Apagar o progresso desta demonstração">↺</button>`;
  // A barra quebra em duas linhas em tela estreita; os painéis descem junto.
  const topbar = document.querySelector('.topbar');
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
  }).observe(topbar);
  hud.querySelector('[data-hud-speed]').value = String(state.speed);
  hud.querySelector('[data-hud-speed]').addEventListener('change', (e) => {
    state.speed = Number(e.target.value);
    save(state);
  });
  hud.querySelector('[data-hud-patrimonio]').addEventListener('click', () => togglePanel());
  hud.querySelector('[data-hud-reset]').addEventListener('click', () => {
    if (!confirm('Apagar lotes, negócios e saldo desta demonstração?')) return;
    for (const i of state.lots) {
      const m = meshes.get(i);
      if (m) group.remove(m.lot, m.box);
    }
    meshes.clear();
    state = fresh();
    save(state);
    api.showLot(null);
    renderPanel();
    renderHud();
    toast('Demonstração reiniciada.');
  });

  function renderHud() {
    hud.querySelector('[data-hud-scity]').textContent = `SCITY ${fmt.format(Math.floor(state.scity))}`;
    hud.querySelector('[data-hud-thaler]').textContent = `THALER ${fmt.format(Math.floor(state.thaler))}`;
    hud.querySelector('[data-hud-patrimonio]').textContent = `Meu patrimônio (${state.lots.length})`;
    const t = controls.target;
    const here = api.lotAt(t.x, t.z);
    hud.querySelector('[data-hud-local]').textContent =
      here === null ? '📍 Fora dos lotes' : `📍 Bairro ${bairroOf(here) + 1} · ${lotId(here)}`;
  }

  // ─ Mensagens ─
  const toastEl = document.createElement('div');
  toastEl.className = 'toast glass';
  toastEl.hidden = true;
  document.body.append(toastEl);
  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 3800);
  }

  // ─ Ações ─
  function buyLot(i) {
    const lots = lotsData();
    const price = priceOf(i);
    if (owns(i) || !lots.vacant[i] || !lots.isOpen(i)) return;
    if (state.scity < price) {
      toast(`Faltam ${fmt.format(price - Math.floor(state.scity))} SCITY para este lote.`);
      return;
    }
    state.scity -= price;
    state.lots.push(i);
    save(state);
    draw(i);
    api.showLot(i);
    renderHud();
    renderPanel();
    toast(`${lotId(i)} é seu por ${fmt.format(price)} SCITY. Agora escolha um negócio para ele.`);
  }

  function build(i, key) {
    const biz = byKey(key);
    const check = eligibility(biz, { zone: zoneOf(i).key, area: lotsData().areas[i] }, state.player);
    if (!owns(i) || state.businesses[i] || !check.ok) return;
    state.thaler -= biz.cost;
    state.businesses[i] = { key, startedAt: state.gameMs };
    save(state);
    draw(i);
    api.showLot(i);
    renderHud();
    renderPanel();
    toast(`Obra de ${biz.label} iniciada: fica pronta em ${biz.buildHours} h de jogo.`);
  }

  function claim(i) {
    const business = state.businesses[i];
    if (!business) return 0;
    const s = businessState(business, state.gameMs);
    if (s.phase !== 'aberto' || s.accrued <= 0) return 0;
    state.thaler += s.accrued;
    business.lastClaim = state.gameMs;
    save(state);
    return s.accrued;
  }

  let flight = null;
  function goTo(i) {
    const [x, z] = centroid(api.lotRing(i));
    flight = {
      from: controls.target.clone(),
      to: new THREE.Vector3(x, 0, z),
      offset: camera.position.clone().sub(controls.target).setLength(420),
      t: 0,
    };
    api.showLot(i);
  }

  // ─ Ficha do lote: o que o jogador pode fazer nele ─
  const duration = (ms) => {
    const h = Math.ceil(ms / 3600000);
    return h >= 48 ? `${Math.ceil(h / 24)} dias` : `${h} h`;
  };

  function businessRows(i) {
    const lot = { zone: zoneOf(i).key, area: lotsData().areas[i] };
    return BUSINESSES.filter((b) => b.zones.includes(lot.zone))
      .map((b) => {
        const check = eligibility(b, lot, state.player);
        return `<div class="negocio${check.ok ? '' : ' negocio--off'}">
          <div><strong>${b.icon} ${esc(b.label)}</strong>
            <small>${fmt.format(b.cost)} THALER · obra ${b.buildHours} h · lucro ${fmt.format(netPerDay(b))}/dia · retorno ${paybackDays(b)} dias</small>
            ${check.ok ? '' : `<small class="motivo">${esc(check.reasons.join(' · '))}</small>`}
          </div>
          <button class="btn btn--blue" type="button" data-gestao="build" data-key="${b.key}" ${check.ok ? '' : 'disabled'}>Construir</button>
        </div>`;
      })
      .join('');
  }

  function decorateLot(i, ficha) {
    const lots = lotsData();
    const mine = owns(i);
    const order = bairroOf(i);
    const bairro = lots.bairros[order];
    const vendidos = state.lots.filter((j) => bairroOf(j) === order).length;
    const limiar = Math.round((lots.liberacao?.limiar ?? 0.7) * 100);
    let html = '';

    if (mine) {
      ficha.querySelector('h2').insertAdjacentHTML('beforeend', ' <span class="tag tag--mine">Seu</span>');
      const status = ficha.querySelector('dd');
      if (status) status.textContent = 'Seu lote';
      const business = state.businesses[i];
      if (business) {
        const biz = byKey(business.key);
        const s = businessState(business, state.gameMs);
        html =
          s.phase === 'obra'
            ? `<h3>${biz.icon} ${esc(biz.label)} · em obra</h3>
               <div class="barra"><span style="width:${Math.round(s.progress * 100)}%"></span></div>
               <p class="muted">${Math.round(s.progress * 100)}% · faltam ${duration(s.leftMs)} de jogo</p>`
            : `<h3>${biz.icon} ${esc(biz.label)} · aberto</h3>
               <p class="muted">Lucro de ${fmt.format(netPerDay(biz))} THALER por dia${s.full ? ' · <strong>acumulado no teto de 7 dias</strong>' : ''}</p>
               <button class="btn btn--primary" type="button" data-gestao="claim" ${s.accrued > 0 ? '' : 'disabled'}>${s.accrued > 0 ? `Coletar ${fmt.format(s.accrued)} THALER` : 'Nada a coletar ainda'}</button>`;
      } else {
        html = `<h3>Abrir negócio</h3><p class="muted">Pago em THALER. A zona do lote define o que cabe nele.</p>${businessRows(i)}`;
      }
    } else if (lots.vacant[i] && lots.isOpen(i)) {
      const price = priceOf(i);
      html = `<button class="btn btn--primary" type="button" data-gestao="buy" ${state.scity >= price ? '' : 'disabled'}>
        Comprar por ${fmt.format(price)} SCITY</button>
        ${state.scity >= price ? '' : `<p class="muted">Seu saldo: ${fmt.format(Math.floor(state.scity))} SCITY.</p>`}`;
    }

    if (bairro && lots.isOpen(i)) {
      html += `<p class="muted pequeno">Bairro ${order + 1}: você tem ${vendidos} de ${fmt.format(bairro.lots)} lotes. O próximo bairro abre quando os abertos passam de ${limiar}% vendidos.</p>`;
    }
    if (!html) return;
    const box = document.createElement('div');
    box.className = 'gestao';
    box.innerHTML = html;
    ficha.append(box);
    box.addEventListener('click', (e) => {
      const button = e.target.closest('[data-gestao]');
      if (!button || button.disabled) return;
      const action = button.dataset.gestao;
      if (action === 'buy') buyLot(i);
      else if (action === 'build') build(i, button.dataset.key);
      else if (action === 'claim') {
        const got = claim(i);
        if (got) toast(`+${fmt.format(got)} THALER coletados.`);
        api.showLot(i);
        renderHud();
        renderPanel();
      }
    });
  }

  // ─ Painel "Meu patrimônio" ─
  const panel = document.createElement('aside');
  panel.className = 'patrimonio glass';
  panel.hidden = true;
  document.body.append(panel);
  const layers = document.querySelector('.layers');

  function togglePanel(force) {
    panel.hidden = force === undefined ? !panel.hidden : !force;
    if (layers) layers.hidden = !panel.hidden;
    renderPanel();
  }

  function renderPanel() {
    if (panel.hidden) return;
    let toCollect = 0;
    let perDay = 0;
    const cards = state.lots
      .map((i) => {
        const business = state.businesses[i];
        const zone = zoneOf(i);
        let detail = '<span class="muted">Sem negócio · escolha um na ficha</span>';
        let action = '';
        if (business) {
          const biz = byKey(business.key);
          const s = businessState(business, state.gameMs);
          if (s.phase === 'obra') {
            detail = `${biz.icon} ${esc(biz.label)} · obra ${Math.round(s.progress * 100)}%
              <div class="barra"><span style="width:${Math.round(s.progress * 100)}%"></span></div>`;
          } else {
            toCollect += s.accrued;
            perDay += netPerDay(biz);
            detail = `${biz.icon} ${esc(biz.label)} · ${fmt.format(netPerDay(biz))}/dia`;
            if (s.accrued > 0) {
              action = `<button class="btn btn--primary pequeno" type="button" data-p="claim" data-i="${i}">Coletar ${fmt.format(s.accrued)}</button>`;
            }
          }
        }
        return `<li>
          <div class="linha"><strong>${lotId(i)}</strong><span class="muted">Bairro ${bairroOf(i) + 1} · ${esc(zone.label)}</span></div>
          <div>${detail}</div>
          <div class="linha">${action}<button class="btn btn--ghost" type="button" data-p="go" data-i="${i}">Ir até</button></div>
        </li>`;
      })
      .join('');

    panel.innerHTML = `
      <div class="linha"><h2>Meu patrimônio</h2><button class="btn btn--ghost" type="button" data-p="close" aria-label="Fechar">✕</button></div>
      <dl class="resumo">
        <dt>Lotes</dt><dd>${state.lots.length}</dd>
        <dt>Negócios abertos</dt><dd>${Object.values(state.businesses).filter((b) => businessState(b, state.gameMs).phase === 'aberto').length}</dd>
        <dt>Lucro por dia</dt><dd>${fmt.format(perDay)} THALER</dd>
        <dt>A coletar</dt><dd>${fmt.format(toCollect)} THALER</dd>
        <dt>Dia do jogo</dt><dd>${Math.floor(state.gameMs / DAY_MS) + 1}</dd>
      </dl>
      ${toCollect > 0 ? '<button class="btn btn--primary" type="button" data-p="claim-all">Coletar tudo</button>' : ''}
      ${state.lots.length ? `<ul>${cards}</ul>` : '<p class="muted">Você ainda não tem lotes. Clique num lote verde no mapa e compre.</p>'}`;
  }

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.p === 'close') togglePanel(false);
    else if (b.dataset.p === 'go') goTo(i);
    else if (b.dataset.p === 'claim') {
      const got = claim(i);
      if (got) toast(`+${fmt.format(got)} THALER coletados.`);
    } else if (b.dataset.p === 'claim-all') {
      const got = state.lots.reduce((sum, j) => sum + claim(j), 0);
      toast(`+${fmt.format(got)} THALER coletados de todos os negócios.`);
    }
    renderHud();
    renderPanel();
  });

  // ─ Relógio do jogo ─
  let last = performance.now();
  let acc = 0;
  function tick() {
    const now = performance.now();
    const dt = now - last;
    last = now;
    state.gameMs += dt * state.speed;

    if (flight) {
      flight.t = Math.min(1, flight.t + dt / 900);
      const k = flight.t * flight.t * (3 - 2 * flight.t);
      controls.target.lerpVectors(flight.from, flight.to, k);
      camera.position.copy(controls.target).add(flight.offset);
      if (flight.t >= 1) flight = null;
    }

    acc += dt;
    if (acc < 500) return;
    acc = 0;
    for (const i of Object.keys(state.businesses)) paint(Number(i));
    renderHud();
    renderPanel();
    const showing = api.currentLot();
    if (showing !== null && state.businesses[showing]) api.showLot(showing);
    save(state);
  }

  for (const i of state.lots) draw(i);
  renderHud();

  return { decorateLot, tick, buyLot, build, claim, goTo, getState: () => state };
}
