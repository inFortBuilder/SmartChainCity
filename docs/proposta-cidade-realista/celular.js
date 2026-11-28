// Celular do personagem no street view (mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// Os painéis do mapa ficam escondidos no street view. O celular traz o essencial deles para a rua, sem sair
// dela: abre no botão "Celular" da barra ou na tecla C, e fecha no Esc ou na barra de início.
// - Carteira: THALER e SCITY (do economy, como no painel).
// - Status: os atributos do avatar (0 a 10), a profissão, a moradia (regular ou não), o que ele pode fazer agora e
//   o tempo (clima.js).
// - GPS: os destinos do minimapa (loja, farmácia, mercado, trabalho, praça); escolher liga o GPS e fecha o celular.
// - Carro: chama o próprio carro (carro-jogo.js).
// - Chat: vai para a caixa de mensagem do bairro (multiplayer.js).
// - Mapa: volta para o mapa (sai do street view).
// O celular só mostra e atalha: nada aqui cobra ou muda o jogo.
//
// Visual de smartphone grande e moderno (proporção de 19,5:9, moldura de metal): ilha preta no alto, barra de
// status (hora, sinal, Wi-Fi, bateria), papel de parede em gradiente, widget com data, hora e tempo, ícones
// quadrados de cantos arredondados com gradiente e símbolo branco (desenhados aqui, em SVG, sem marca de
// ninguém), dock de vidro fosco e a barra de início embaixo (num app, volta ao início; no início, fecha).
// Nas telas dos apps: fundo preto, "‹ Início" em azul, título grande e listas agrupadas em cartões.

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

/** Os símbolos dos ícones (SVG 24×24, branco). */
const GLYPH = {
  carteira: '<rect x="3" y="7" width="18" height="12" rx="3"/><path d="M3 11h18"/><circle cx="16.5" cy="15" r="1.3" fill="#fff" stroke="none"/><path d="M6 7l9-3 1.4 3"/>',
  status: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="#fff" stroke="none"/>',
  gps: '<path d="M20 4 4 11l7 2 2 7z" fill="#fff" stroke="none"/>',
  carro: '<path d="M5 13l1.6-5h10.8L19 13"/><rect x="3" y="13" width="18" height="4.5" rx="1.5" fill="#fff" stroke="none"/><circle cx="7" cy="19" r="1.6" fill="#fff" stroke="none"/><circle cx="17" cy="19" r="1.6" fill="#fff" stroke="none"/>',
  chat: '<path d="M12 4c4.6 0 8 2.9 8 6.5S16.6 17 12 17c-.9 0-1.8-.1-2.6-.3L5 19l1.2-3.3C4.8 14.5 4 12.6 4 10.5 4 6.9 7.4 4 12 4z" fill="#fff" stroke="none"/>',
  mapa: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
};
/** Rótulo e as duas cores do gradiente de cada app. */
const APPS = {
  carteira: ['Carteira', '#5ee07a', '#1f9d45'],
  status: ['Status', '#ff7a96', '#e11d48'],
  gps: ['GPS', '#5ac8fa', '#0a6cff'],
  carro: ['Carro', '#ffb340', '#f06a00'],
  chat: ['Chat', '#4ade80', '#16a34a'],
  mapa: ['Mapa', '#7dd3fc', '#0e9f8f'],
};
const icon = (id) => {
  const [label, a, b] = APPS[id];
  return `<button class="cel-app" type="button" data-app="${id}" aria-label="${label}"><span class="cel-ico" style="background:linear-gradient(160deg,${a},${b})"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPH[id]}</svg></span><span class="cel-rot">${label}</span></button>`;
};
/** Sinal, Wi-Fi e bateria, na barra de status. */
const STATUS_ICONS =
  '<svg viewBox="0 0 18 12" width="17" height="11" fill="#fff"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>' +
  '<svg viewBox="0 0 16 12" width="15" height="11" fill="#fff"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0z"/><path d="M3.4 6.8a6.5 6.5 0 0 1 9.2 0l-1.4 1.4a4.5 4.5 0 0 0-6.4 0z"/><path d="M1.2 4.6a9.6 9.6 0 0 1 13.6 0l-1.4 1.4a7.6 7.6 0 0 0-10.8 0z"/></svg>' +
  '<svg viewBox="0 0 27 13" width="25" height="12"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="#fff" stroke-opacity=".45"/><rect x="2" y="2" width="17" height="9" rx="2" fill="#fff"/><rect x="24.5" y="4.5" width="1.6" height="4" rx=".8" fill="#fff" fill-opacity=".45"/></svg>';

const CSS = `
  .cel { position: fixed; left: 16px; bottom: 16px; z-index: 9; width: 300px; height: 650px; max-height: calc(100vh - 32px);
    border-radius: 54px; padding: 11px; box-sizing: border-box; background: linear-gradient(145deg, #5a5f67, #1d2024 40%, #44484f);
    box-shadow: 0 0 0 1.5px #767b83, 0 18px 40px rgba(0,0,0,.55), inset 0 0 0 2px #0b0c0e; color: #fff;
    font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .cel[hidden] { display: none; }
  .cel-scr { position: relative; height: 100%; border-radius: 44px; overflow: hidden; display: flex; flex-direction: column;
    background: radial-gradient(120% 70% at 15% 0%, #ff8a5c 0%, transparent 55%), radial-gradient(110% 70% at 100% 40%, #7c4dff 0%, transparent 60%),
      radial-gradient(120% 80% at 0% 100%, #00a6ff 0%, transparent 60%), #1b1440; }
  .cel-scr.app { background: #000; }
  .cel-top { position: relative; height: 48px; flex: none; display: flex; justify-content: space-between; align-items: center;
    padding: 4px 24px 0 32px; font: 600 15px -apple-system, system-ui, sans-serif; }
  .cel-ilha { position: absolute; left: 50%; top: 11px; transform: translateX(-50%); width: 94px; height: 27px; border-radius: 20px; background: #000; }
  .cel-sinais { display: flex; gap: 5px; align-items: center; }
  .cel-tela { flex: 1; overflow: auto; padding: 0 16px 6px; scrollbar-width: none; }
  .cel-tela::-webkit-scrollbar { display: none; }
  .cel-home { display: flex; flex-direction: column; min-height: 100%; }
  .cel-widget { margin: 6px 2px 20px; padding: 12px 14px; border-radius: 22px; background: rgba(255,255,255,.17);
    backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); display: flex; justify-content: space-between; align-items: flex-end; }
  .cel-widget b { display: block; font-size: 36px; font-weight: 300; letter-spacing: -.5px; line-height: 1.05; }
  .cel-widget small { opacity: .9; font-size: 12px; text-transform: capitalize; }
  .cel-grade { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 4px; }
  .cel-app { border: 0; background: none; color: #fff; cursor: pointer; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 5px; }
  .cel-ico { width: 56px; height: 56px; border-radius: 14px; display: grid; place-items: center;
    box-shadow: 0 2px 6px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.35); }
  .cel-ico svg { width: 32px; height: 32px; }
  .cel-app:active .cel-ico { filter: brightness(.8); }
  .cel-rot { font-size: 11px; text-shadow: 0 1px 2px rgba(0,0,0,.5); }
  .cel-dica { text-align: center; font-size: 11px; opacity: .75; margin: 16px 0 12px; }
  .cel-dock { margin-top: auto; padding: 12px 10px; border-radius: 30px; background: rgba(255,255,255,.2);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); display: flex; justify-content: space-evenly; }
  .cel-dock .cel-rot { display: none; }
  .cel-barra-inicio { flex: none; height: 22px; display: grid; place-items: center; cursor: pointer; border: 0; background: none; padding: 0; }
  .cel-barra-inicio i { display: block; width: 128px; height: 5px; border-radius: 3px; background: #fff; }
  .cel-nav { display: flex; align-items: center; height: 30px; }
  .cel-nav button { border: 0; background: none; color: #0a84ff; font: 17px -apple-system, system-ui, sans-serif; cursor: pointer; padding: 0; }
  .cel h4 { margin: 2px 0 12px; font-size: 28px; font-weight: 700; letter-spacing: -.3px; }
  .cel .grupo { background: #1c1c1e; border-radius: 12px; padding: 2px 14px; margin-bottom: 14px; }
  .cel .linha-v { display: flex; justify-content: space-between; gap: 10px; padding: 11px 0; border-bottom: .5px solid #38383a; }
  .cel .grupo > .linha-v:last-child { border-bottom: 0; }
  .cel .linha-v > :last-child { text-align: right; color: #ebebf5a0; }
  .cel .linha-v b { color: #fff; }
  .cel .barra { height: 6px; border-radius: 3px; background: #38383a; overflow: hidden; margin: 0 0 10px; }
  .cel .barra i { display: block; height: 100%; background: #30d158; }
  .cel .barra i.baixo { background: #ff453a; }
  .cel .barra i.medio { background: #ff9f0a; }
  .cel .lista { background: #1c1c1e; border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
  .cel .lista button { display: flex; justify-content: space-between; align-items: center; width: 100%; text-align: left; border: 0;
    border-bottom: .5px solid #38383a; padding: 13px 14px; background: none; color: #fff; cursor: pointer; font: 16px -apple-system, system-ui, sans-serif; }
  .cel .lista button::after { content: '›'; color: #ebebf54d; font-size: 22px; line-height: 16px; }
  .cel .lista button:last-child { border-bottom: 0; }
  .cel .muted { color: #ebebf5a0; font-size: 13px; }
  @media (max-width: 640px) { .cel { left: 50%; transform: translateX(-50%); width: min(300px, calc(100vw - 32px)); height: min(650px, calc(100vh - 32px)); } }
`;

export function createPhone({ streetView, servidor, minimap = null, places = () => [], playerCar = null, weather = () => null }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const box = document.createElement('div');
  box.className = 'cel';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Celular');
  box.innerHTML = `<div class="cel-scr" data-scr>
    <div class="cel-top"><span data-hora></span><span class="cel-ilha"></span><span class="cel-sinais">${STATUS_ICONS}</span></div>
    <div class="cel-tela" data-tela></div>
    <button class="cel-barra-inicio" type="button" data-inicio aria-label="Início"><i></i></button></div>`;
  document.body.append(box);
  const tela = box.querySelector('[data-tela]');
  const scr = box.querySelector('[data-scr]');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.celular = '';
  btn.textContent = 'Celular';
  btn.style.whiteSpace = 'nowrap';
  document.querySelector('.sv-bar')?.append(btn);

  let screen = 'home';
  const stats = { opens: 0, screens: {} };
  const hhmm = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  function home() {
    const data = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    const tempo = weather()?.label;
    return `<div class="cel-home">
      <div class="cel-widget"><div><small>${esc(data)}</small><b>${hhmm()}</b></div><small data-v="tempo-widget">${tempo ? esc(tempo) : ''}</small></div>
      <div class="cel-grade">${['carteira', 'status', 'gps', 'carro'].map(icon).join('')}</div>
      <p class="cel-dica">C abre e fecha · Esc volta</p>
      <div class="cel-dock">${['chat', 'mapa'].map(icon).join('')}</div></div>`;
  }

  function carteira() {
    const d = servidor.getData?.() ?? {};
    if (!servidor.getSession?.()) return '<h4>Carteira</h4><p class="muted">Entre no jogo para ver o saldo.</p>';
    return `<h4>Carteira</h4><div class="grupo">
      <div class="linha-v"><span>THALER</span><b data-v="thaler">${thaler(d.balance)}</b></div>
      <div class="linha-v"><span>SCITY</span><b data-v="scity">${scityText(d.scity)}</b></div></div>
      <p class="muted">Depósitos, saques e câmbio ficam no painel do mapa.</p>`;
  }

  function status() {
    const a = servidor.getData?.()?.avatar;
    if (!a) return '<h4>Status</h4><p class="muted">Entre no jogo e pegue um avatar.</p>';
    const bars = ATTRS.map(([k, label]) => {
      const v = Number(a.attributes?.[k] ?? 0);
      const cls = v <= 3 ? 'baixo' : v <= 6 ? 'medio' : '';
      return `<div class="linha-v" style="border:0;padding:9px 0 5px"><span>${label}</span><span data-attr="${k}">${v}/10</span></div><div class="barra"><i class="${cls}" style="width:${v * 10}%"></i></div>`;
    }).join('');
    const s = a.status ?? {};
    const now = s.inHospital ? 'Internado' : s.resting ? 'Dormindo' : s.mustRest ? 'Precisa dormir' : s.atMarket ? 'No mercado' : s.canWork ? 'Pode trabalhar' : 'Não pode trabalhar agora';
    const h = servidor.housing?.();
    const moradia = h ? (h.factor === 1 ? 'Moradia regular' : 'Sem moradia regular (turno a 50%)') : 'Moradia: veja no painel';
    return `<h4>${esc(a.job?.label ?? 'Avatar')}</h4><div class="grupo">${bars}</div><div class="grupo">
      <div class="linha-v"><span>Agora</span><b data-v="agora">${now}</b></div>
      <div class="linha-v"><span>Casa</span><span data-v="moradia">${moradia}</span></div>
      <div class="linha-v"><span>Tempo</span><span data-v="tempo">${esc(weather()?.label ?? '—')}</span></div></div>`;
  }

  function gps() {
    const list = places();
    if (!minimap || !list.length) return '<h4>GPS</h4><p class="muted">Sem destinos por perto.</p>';
    return `<h4>GPS</h4><div class="lista">${list.map((p) => `<button type="button" data-ir="${esc(p.id)}">${esc(p.label)}</button>`).join('')}</div>`;
  }

  function carro() {
    if (!playerCar) return '<h4>Carro</h4><p class="muted">Sem carro nesta cidade.</p>';
    const ok = (servidor.myCars?.() ?? []).find((v) => v.state === 'ok');
    return `<h4>Carro</h4>${ok ? `<div class="grupo"><div class="linha-v"><span>${esc(ok.label)}</span><span>Em dia</span></div></div><div class="lista"><button type="button" data-chamar>Chamar o carro para cá</button></div>` : '<p class="muted">A conta não tem carro em dia (agência no painel).</p>'}`;
  }

  function render() {
    stats.screens[screen] = (stats.screens[screen] ?? 0) + 1;
    box.querySelector('[data-hora]').textContent = hhmm();
    scr.classList.toggle('app', screen !== 'home');
    const nav = screen === 'home' ? '' : '<div class="cel-nav"><button type="button" data-voltar>‹ Início</button></div>';
    tela.innerHTML = nav + ({ home, carteira, status, gps, carro }[screen]?.() ?? home());
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
  /** A barra de início e o "‹ Início": num app, volta ao início; no início, fecha. */
  const back = () => {
    if (screen === 'home') close();
    else {
      screen = 'home';
      render();
    }
  };

  btn.addEventListener('click', toggle);
  box.querySelector('[data-inicio]').addEventListener('click', back);
  tela.addEventListener('click', (e) => {
    if (e.target.closest('[data-voltar]')) {
      back();
      return;
    }
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
    else if (k === 'escape' && !box.hidden) back();
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
