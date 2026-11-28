// O avatar anda de ônibus no street view (fase 3 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// 1. No ponto de ônibus (onibus.js), com o ônibus parado na frente (carros.js), aparece "E Embarcar".
//    Como é dinheiro, o 1º E pede confirmação e o 2º, em 4 s, paga.
// 2. A passagem sai pelo game-core (POST /v1/avatars/:id/bus-ride, 3 THALER pelo ledger, o mesmo preço do
//    deslocamento de ônibus do turno). Sem a cobrança aceita, ninguém embarca.
// 3. Embarcado, o avatar some e vai junto com o ônibus; a câmera se afasta para ver o ônibus de fora.
// 4. No próximo ponto em que o ônibus para, o avatar desce na calçada, na espera do ponto.
//
// Se o ônibus sair da cena (o que não deve acontecer com o avatar dentro), o avatar desce onde ele estava.
// PREMISSAS: embarque a menos de 4 m da espera do ponto, com a porta a menos de 12 m; viagem de até 4 min.

export const RIDE = { reach: 4, door: 12, confirmMs: 4000, maxMs: 240_000 };

const ERRORS = {
  insufficient_thaler: 'THALER insuficiente para a passagem.',
  no_session: 'Entre no jogo e pegue um avatar para andar de ônibus.',
  in_hospital: 'Internado: sem passeio.',
  resting: 'O avatar está dormindo.',
  sick: 'O avatar está de cama.',
};

const thaler = (cents) => (Number(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function createBusRide({ streetView, traffic, servidor, opt = RIDE }) {
  const style = document.createElement('style');
  style.textContent = `
    .vg-prompt { position: fixed; left: 50%; bottom: 110px; transform: translateX(-50%); z-index: 8; padding: 9px 16px; border-radius: 999px;
      background: rgba(15,23,42,.9); color: #fff; font: 600 14px system-ui, sans-serif; display: flex; gap: 10px; align-items: center; max-width: calc(100vw - 32px); }
    .vg-prompt[hidden] { display: none; }
    .vg-prompt kbd { background: #22c55e; color: #0b1220; border-radius: 6px; padding: 2px 8px; font: 800 13px system-ui, sans-serif; }
    .vg-prompt button { border: 0; border-radius: 8px; padding: 5px 10px; font-weight: 700; cursor: pointer; }
    .vg-prompt.confirma { outline: 2px solid #22c55e; }
    @media (max-width: 640px) { .vg-prompt { bottom: 440px; } }
  `;
  document.head.append(style);
  const prompt = document.createElement('div');
  prompt.className = 'vg-prompt';
  prompt.hidden = true;
  document.body.append(prompt);

  let fare = 300n;
  servidor.routineCatalog?.().then((c) => { if (c?.bus_fare) fare = BigInt(c.bus_fare); }).catch(() => {});
  /** idle: a pé; paying: esperando o game-core; riding: no ônibus. */
  let state = 'idle';
  let board = null; // { stopKey, at } quando embarcou
  let near = null; // o ponto com o ônibus parado, ao alcance
  let armed = 0;
  let msg = null;
  let msgUntil = 0;
  const stats = { rides: 0, refused: 0, alighted: 0 };

  const flash = (text, ms = 2800) => {
    msg = text;
    msgUntil = performance.now() + ms;
  };

  function render() {
    const now = performance.now();
    if (msg && now > msgUntil) msg = null;
    if (state === 'riding') {
      prompt.hidden = false;
      prompt.classList.remove('confirma');
      prompt.innerHTML = '<span>No ônibus: desce no próximo ponto.</span>';
      return;
    }
    if (msg) {
      prompt.hidden = false;
      prompt.classList.remove('confirma');
      prompt.innerHTML = `<span>${msg}</span>`;
      return;
    }
    if (!near || state !== 'idle') {
      prompt.hidden = true;
      return;
    }
    const confirming = now - armed < opt.confirmMs;
    prompt.hidden = false;
    prompt.classList.toggle('confirma', confirming);
    const line = traffic.busState()?.line?.name;
    prompt.innerHTML = `<kbd>E</kbd><span>${confirming ? 'Confirmar: passagem' : `${line ?? 'Ônibus'} no ponto: passagem`} · ${thaler(fare)} THALER</span><button type="button">${confirming ? 'Confirmar' : 'Embarcar'}</button>`;
    prompt.querySelector('button').onclick = () => act();
  }

  async function act() {
    if (state !== 'idle' || !near) return;
    // 1º E: confirmação (é dinheiro); 2º E, em 4 s: paga e embarca.
    if (performance.now() - armed > opt.confirmMs) {
      armed = performance.now();
      return;
    }
    armed = 0;
    state = 'paying';
    const stopKey = near.stop.key;
    try {
      const r = await servidor.avatarPost('bus-ride', {});
      const bus = traffic.busState();
      if (!bus?.dwelling) throw Object.assign(new Error('O ônibus já saiu.'), { code: 'gone' });
      state = 'riding';
      board = { stopKey, at: performance.now() };
      stats.lastLine = bus.line?.name ?? null;
      stats.rides++;
      streetView.startRide(() => traffic.busState());
      traffic.setRiding(true);
      flash(`Passagem paga: −${thaler(r.ride.price)} THALER · ${bus.line?.name ?? 'ônibus'}.`);
      servidor.refresh?.();
    } catch (e) {
      state = 'idle';
      stats.refused++;
      flash(ERRORS[e.code] ?? e.message);
    }
  }

  function alight(at) {
    state = 'idle';
    board = null;
    traffic.setRiding(false);
    streetView.endRide(at.x, at.z);
    stats.alighted++;
    flash('Desceu no ponto.');
  }

  addEventListener('keydown', (e) => {
    if (!streetView.active() || e.target.closest?.('input, textarea, select')) return;
    if (e.key.toLowerCase() === 'e' && near && state === 'idle') act();
  });

  function update() {
    if (!streetView.active()) {
      prompt.hidden = true;
      return;
    }
    const bus = traffic.busState();
    if (state === 'riding') {
      const stops = streetView.busStops();
      if (!bus) {
        // O ônibus sumiu: desce onde estava, na rua mais perto.
        const p = streetView.position();
        const r = streetView.nearestRoad(p.x, p.z, 30) ?? p;
        alight(r);
      } else if (bus.dwelling && bus.stopKey !== board.stopKey) {
        const s = stops.find((x) => x.key === bus.stopKey);
        alight(s ? s.wait : bus.door);
      } else if (performance.now() - board.at > opt.maxMs) {
        alight(bus.door);
      }
      render();
      return;
    }
    // A pé: o ponto ao alcance, com o ônibus parado nele (dirigindo o próprio carro, não).
    near = null;
    if (streetView.riding()) {
      prompt.hidden = true;
      return;
    }
    if (bus?.dwelling) {
      const a = streetView.position();
      const s = streetView.busStops().find((x) => Math.hypot(x.wait.x - a.x, x.wait.z - a.z) < opt.reach && Math.hypot(x.bay.x - bus.door.x, x.bay.z - bus.door.z) < opt.door);
      if (s) near = { stop: s };
    }
    render();
  }

  return {
    update,
    debug: () => ({ state, near: near?.stop.key ?? null, board: board?.stopKey ?? null, fare: fare.toString(), ...stats }),
    /** Para testes: o mesmo do E (duas vezes confirma). */
    press: () => act(),
  };
}
