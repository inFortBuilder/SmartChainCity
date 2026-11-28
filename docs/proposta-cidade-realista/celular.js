// Celular do personagem no street view (mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// Os painéis do mapa ficam escondidos no street view. O celular traz o essencial deles para a rua, sem sair
// dela: abre no botão "Celular" da barra ou na tecla C, e fecha no Esc ou no botão de voltar.
// - Carteira: THALER e SCITY (do economy, como no painel).
// - Status: os atributos do avatar (0 a 10), a profissão, a moradia (regular ou não), o que ele pode fazer agora e
//   o tempo (clima.js).
// - GPS: os destinos do minimapa (loja, farmácia, mercado, trabalho); escolher liga o GPS e fecha o celular.
// - Carro: chama o próprio carro (carro-jogo.js).
// - Chat: vai para a caixa de mensagem do bairro (multiplayer.js).
// - Mapa: volta para o mapa (sai do street view).
// O celular só mostra e atalha: nada aqui cobra ou muda o jogo.

const SCITY_DECIMALS = 18n;

const thaler = (cents) => (Number(cents ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** SCITY tem 18 casas: mostra com 2. */
export function scityText(wei) {
  try {
    const v = BigInt(wei ?? 0);
    const whole = v / 10n ** SCITY_DECIMALS;
    const frac = Number((v % 10n ** SCITY_DECIMALS) / 10n ** (SCITY_DECIMALS - 2n));
    return `${whole.toLocaleString('pt-BR')},${String(frac).padStart(2, '0')}`;
  } catch {
    return '0,00';
  }
}

const ATTRS = [
  ['food', 'Alimentação'],
  ['energy', 'Energia'],
  ['health', 'Saúde'],
  ['hygiene', 'Higiene'],
  ['happiness', 'Felicidade'],
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createPhone({ streetView, servidor, minimap = null, places = () => [], playerCar = null, weather = () => null }) {
  const style = document.createElement('style');
  style.textContent = `
    .cel { position: fixed; left: 16px; bottom: 16px; z-index: 9; width: 260px; height: 460px; border-radius: 28px; padding: 14px 12px 18px;
      background: #0b1220; box-shadow: 0 10px 30px rgba(0,0,0,.45); border: 3px solid #334155; display: flex; flex-direction: column; color: #e2e8f0;
      font: 14px system-ui, sans-serif; }
    .cel[hidden] { display: none; }
    .cel-top { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #94a3b8; margin-bottom: 8px; }
    .cel-top button { border: 0; background: #1e293b; color: #e2e8f0; border-radius: 8px; padding: 3px 9px; cursor: pointer; }
    .cel-tela { flex: 1; overflow: auto; }
    .cel-grade { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 8px; }
    .cel-app { border: 0; border-radius: 16px; padding: 12px 4px 8px; background: #1e293b; color: #e2e8f0; cursor: pointer; font: 600 11px system-ui; }
    .cel-app span { display: block; font-size: 24px; margin-bottom: 4px; }
    .cel h4 { margin: 4px 0 10px; font-size: 16px; }
    .cel .linha-v { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid #1e293b; }
    .cel .linha-v > :last-child { text-align: right; }
    .cel .barra { height: 8px; border-radius: 4px; background: #1e293b; overflow: hidden; margin: 2px 0 8px; }
    .cel .barra i { display: block; height: 100%; background: #22c55e; }
    .cel .barra i.baixo { background: #ef4444; }
    .cel .barra i.medio { background: #f59e0b; }
    .cel .lista button { display: block; width: 100%; text-align: left; border: 0; border-radius: 10px; margin: 6px 0; padding: 10px; background: #1e293b; color: #e2e8f0; cursor: pointer; }
    .cel .muted { color: #94a3b8; font-size: 12px; }
    @media (max-width: 640px) { .cel { width: calc(100vw - 32px); height: 60vh; } }
  `;
  document.head.append(style);
  const box = document.createElement('div');
  box.className = 'cel';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Celular');
  box.innerHTML = '<div class="cel-top"><span data-hora></span><button type="button" data-voltar>Voltar</button></div><div class="cel-tela" data-tela></div>';
  document.body.append(box);
  const tela = box.querySelector('[data-tela]');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.celular = '';
  btn.textContent = 'Celular';
  btn.style.whiteSpace = 'nowrap';
  document.querySelector('.sv-bar')?.append(btn);

  let screen = 'home';
  const stats = { opens: 0, screens: {} };

  function home() {
    const apps = [
      ['carteira', '💰', 'Carteira'],
      ['status', '❤️', 'Status'],
      ['gps', '🧭', 'GPS'],
      ['carro', '🚗', 'Carro'],
      ['chat', '💬', 'Chat'],
      ['mapa', '🗺️', 'Mapa'],
    ];
    return `<div class="cel-grade">${apps.map(([id, ico, label]) => `<button class="cel-app" type="button" data-app="${id}"><span>${ico}</span>${label}</button>`).join('')}</div>
      <p class="muted" style="margin-top:14px">C abre e fecha · Esc volta</p>`;
  }

  function carteira() {
    const d = servidor.getData?.() ?? {};
    if (!servidor.getSession?.()) return '<h4>Carteira</h4><p class="muted">Entre no jogo para ver o saldo.</p>';
    return `<h4>Carteira</h4>
      <div class="linha-v"><span>THALER</span><b data-v="thaler">${thaler(d.balance)}</b></div>
      <div class="linha-v"><span>SCITY</span><b data-v="scity">${scityText(d.scity)}</b></div>
      <p class="muted">Depósitos, saques e câmbio ficam no painel do mapa.</p>`;
  }

  function status() {
    const a = servidor.getData?.()?.avatar;
    if (!a) return '<h4>Status</h4><p class="muted">Entre no jogo e pegue um avatar.</p>';
    const bars = ATTRS.map(([k, label]) => {
      const v = Number(a.attributes?.[k] ?? 0);
      const cls = v <= 3 ? 'baixo' : v <= 6 ? 'medio' : '';
      return `<div class="linha-v" style="border:0;padding:2px 0"><span>${label}</span><span data-attr="${k}">${v}/10</span></div><div class="barra"><i class="${cls}" style="width:${v * 10}%"></i></div>`;
    }).join('');
    const s = a.status ?? {};
    const now = s.inHospital ? 'Internado' : s.resting ? 'Dormindo' : s.mustRest ? 'Precisa dormir' : s.atMarket ? 'No mercado' : s.canWork ? 'Pode trabalhar' : 'Não pode trabalhar agora';
    const h = servidor.housing?.();
    const moradia = h ? (h.factor === 1 ? 'Moradia regular' : 'Sem moradia regular (turno a 50%)') : 'Moradia: veja no painel';
    return `<h4>${esc(a.job?.label ?? 'Avatar')}</h4>${bars}
      <div class="linha-v"><span>Agora</span><b data-v="agora">${now}</b></div>
      <div class="linha-v"><span>Casa</span><span data-v="moradia">${moradia}</span></div>
      <div class="linha-v"><span>Tempo</span><span data-v="tempo">${esc(weather()?.label ?? '—')}</span></div>`;
  }

  function gps() {
    const list = places();
    if (!minimap || !list.length) return '<h4>GPS</h4><p class="muted">Sem destinos por perto.</p>';
    return `<h4>GPS</h4><div class="lista">${list.map((p) => `<button type="button" data-ir="${esc(p.id)}">${esc(p.label)}</button>`).join('')}</div>`;
  }

  function carro() {
    if (!playerCar) return '<h4>Carro</h4><p class="muted">Sem carro nesta cidade.</p>';
    const ok = (servidor.myCars?.() ?? []).find((v) => v.state === 'ok');
    return `<h4>Carro</h4>${ok ? `<p>${esc(ok.label)}</p><div class="lista"><button type="button" data-chamar>Chamar o carro para cá</button></div>` : '<p class="muted">A conta não tem carro em dia (agência no painel).</p>'}`;
  }

  function render() {
    stats.screens[screen] = (stats.screens[screen] ?? 0) + 1;
    box.querySelector('[data-hora]').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    box.querySelector('[data-voltar]').textContent = screen === 'home' ? 'Fechar' : 'Voltar';
    tela.innerHTML = { home, carteira, status, gps, carro }[screen]?.() ?? home();
  }

  function open(to = 'home') {
    if (!streetView.active()) return;
    screen = to;
    box.hidden = false;
    stats.opens++;
    render();
    // Os números do celular vêm do último refresh; pede um novo e redesenha.
    servidor.refresh?.()?.then?.(() => { if (!box.hidden) render(); }).catch?.(() => {});
  }
  const close = () => { box.hidden = true; };
  const toggle = () => (box.hidden ? open() : close());

  btn.addEventListener('click', toggle);
  box.querySelector('[data-voltar]').addEventListener('click', () => {
    if (screen === 'home') close();
    else {
      screen = 'home';
      render();
    }
  });
  tela.addEventListener('click', (e) => {
    const app = e.target.closest('[data-app]')?.dataset.app;
    if (app === 'chat') {
      close();
      const input = document.querySelector('[data-mp-form] input');
      input?.focus();
      return;
    }
    if (app === 'mapa') {
      close();
      streetView.exit?.();
      return;
    }
    if (app) {
      screen = app;
      render();
      return;
    }
    const ir = e.target.closest('[data-ir]')?.dataset.ir;
    if (ir) {
      minimap?.go(ir);
      close();
      return;
    }
    if (e.target.closest('[data-chamar]')) {
      playerCar?.call();
      close();
    }
  });
  addEventListener('keydown', (e) => {
    if (!streetView.active() || e.target.closest?.('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'c' && !e.repeat) toggle();
    else if (k === 'escape' && !box.hidden) close();
  });

  return {
    update() {
      btn.hidden = !streetView.active();
      if (!streetView.active() && !box.hidden) close();
    },
    open,
    close,
    debug: () => ({ open: !box.hidden, screen, ...stats, text: box.hidden ? '' : tela.innerText }),
  };
}
