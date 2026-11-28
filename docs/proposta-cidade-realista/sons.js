// Sons da cidade no street view (fase 3 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// Tudo sintetizado com a Web Audio, sem arquivo de som (nada para baixar nem licenciar):
// - fundo da cidade: ruído filtrado em 350 Hz, baixo e constante;
// - motores: 4 vozes (dente de serra filtrado, com um pouco de ruído) presas aos 4 carros mais perto,
//   posicionadas no espaço (PannerNode); o tom sobe com a velocidade, e o ônibus é mais grave e mais alto;
// - passos do avatar: um estalo curto de ruído a cada passo (0,5 s andando, 0,32 s correndo);
// - bipe da travessia: no semáforo a menos de 15 m, um bipe por segundo enquanto o pedestre pode atravessar.
//
// O navegador só deixa tocar depois de um gesto do jogador: o som começa no primeiro clique ou tecla do
// street view. O botão "Som" na barra liga e desliga (fica salvo neste navegador).
//
// PREMISSAS: 4 vozes de motor; fundo a 3% do volume; motor de 45 a 95 Hz (ônibus de 30 a 60 Hz);
// distância de referência de 6 m; bipe a 880 Hz a menos de 15 m.

export const SOUND = { voices: 4, ambient: 0.03, engine: 0.12, bus: 0.2, step: 0.18, beep: 0.08, refDistance: 6, beepRange: 15 };

const KEY = 'scc-som';

/** Tom do motor (Hz) pela velocidade (m/s). */
export const engineHz = (speed, bus = false) => (bus ? 30 + Math.min(speed, 10) * 3 : 45 + Math.min(speed, 12) * 4.2);

/** Intervalo entre passos (s) pela velocidade do avatar, ou null parado. */
export const stepEvery = (speed) => (speed > 3 ? 0.32 : speed > 0.2 ? 0.5 : null);

export function createSounds({ streetView, camera, cars = () => [], signals = () => null, opt = SOUND }) {
  let on = true;
  try {
    on = localStorage.getItem(KEY) !== '0';
  } catch {
    on = true;
  }
  let ctx = null;
  let master = null;
  const voices = [];
  let noiseBuf = null;
  let stepClock = 0;
  let beepClock = 0;
  const stats = { steps: 0, beeps: 0 };

  // Botão na barra do street view.
  const bar = document.querySelector('.sv-bar');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.som = '';
  const label = () => {
    btn.textContent = on ? 'Som: ligado' : 'Som: desligado';
    btn.setAttribute('aria-pressed', String(on));
  };
  label();
  bar?.append(btn);
  btn.addEventListener('click', () => {
    on = !on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // aba anônima: vale só agora
    }
    label();
    start();
    if (master) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.05);
  });

  /** Ruído branco de 2 s, reaproveitado pelo fundo, pelos motores e pelos passos. */
  function noise() {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /** Cria o contexto no primeiro gesto (regra do navegador). */
  function start() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = on ? 1 : 0;
    master.connect(ctx.destination);
    noiseBuf = noise();
    // Fundo da cidade.
    const amb = ctx.createBufferSource();
    amb.buffer = noiseBuf;
    amb.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350;
    const ag = ctx.createGain();
    ag.gain.value = opt.ambient;
    amb.connect(lp).connect(ag).connect(master);
    amb.start();
    // Vozes de motor.
    for (let i = 0; i < opt.voices; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const rumble = ctx.createBufferSource();
      rumble.buffer = noiseBuf;
      rumble.loop = true;
      const rg = ctx.createGain();
      rg.gain.value = 0.25;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = opt.refDistance;
      p.rolloffFactor = 1.2;
      osc.connect(f);
      rumble.connect(rg).connect(f);
      f.connect(g).connect(p).connect(master);
      osc.start();
      rumble.start(0, Math.random() * 2);
      voices.push({ osc, gain: g, panner: p, car: null });
    }
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => streetView.active() && start(), { passive: true });

  /** Um estalo curto de ruído (passo) ou um bipe, agora. */
  function blip(kind, x, y, z) {
    const t = ctx.currentTime;
    const g = ctx.createGain();
    if (kind === 'step') {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + Math.random() * 500;
      bp.Q.value = 1.2;
      g.gain.setValueAtTime(opt.step, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      s.connect(bp).connect(g).connect(master);
      s.start(t, Math.random() * 1.5, 0.1);
    } else {
      const o = ctx.createOscillator();
      o.frequency.value = 880;
      const p = ctx.createPanner();
      p.refDistance = 3;
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
      g.gain.setValueAtTime(opt.beep, t);
      g.gain.setValueAtTime(0, t + 0.12);
      o.connect(g).connect(p).connect(master);
      o.start(t);
      o.stop(t + 0.15);
    }
  }

  const fwd = { x: 0, y: 0, z: -1 };
  function update(dt) {
    if (!ctx) return;
    const active = streetView.active() && on;
    if (!active) {
      for (const v of voices) v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      return;
    }
    // Ouvinte na câmera.
    const L = ctx.listener;
    const cp = camera.position;
    const d = camera.getWorldDirection ? camera.getWorldDirection(new camera.position.constructor()) : fwd;
    if (L.positionX) {
      L.positionX.value = cp.x;
      L.positionY.value = cp.y;
      L.positionZ.value = cp.z;
      L.forwardX.value = d.x;
      L.forwardY.value = d.y;
      L.forwardZ.value = d.z;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    }
    // Os 4 carros mais perto ganham as vozes.
    const a = streetView.position();
    const near = cars()
      .map((c) => ({ ...c, d: Math.hypot(c.x - a.x, c.z - a.z) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, voices.length);
    const y = streetView.groundY() + 0.6;
    voices.forEach((v, i) => {
      const c = near[i];
      const t = ctx.currentTime;
      if (!c) {
        v.car = null;
        v.gain.gain.setTargetAtTime(0, t, 0.15);
        return;
      }
      v.car = c;
      v.panner.positionX.setTargetAtTime(c.x, t, 0.05);
      v.panner.positionY.value = y;
      v.panner.positionZ.setTargetAtTime(c.z, t, 0.05);
      v.osc.frequency.setTargetAtTime(engineHz(c.speed, c.bus), t, 0.2);
      // Parado, o motor fica em marcha lenta (mais baixo).
      const base = c.bus ? opt.bus : opt.engine;
      v.gain.gain.setTargetAtTime(base * (c.speed > 0.5 ? 1 : 0.4), t, 0.2);
    });
    // Passos.
    const every = streetView.jumping?.() ? null : stepEvery(streetView.speed());
    if (every) {
      stepClock += dt;
      if (stepClock >= every) {
        stepClock = 0;
        blip('step');
        stats.steps++;
      }
    } else stepClock = 0;
    // Bipe da travessia no semáforo mais perto.
    const sg = signals();
    beepClock += dt;
    if (sg && beepClock >= 1) {
      beepClock = 0;
      const arm = sg
        .arms()
        .map((x) => ({ ...x, d: Math.hypot(x.x - a.x, x.z - a.z) }))
        .sort((p, q) => p.d - q.d)[0];
      if (arm && arm.d < opt.beepRange && sg.walkOk(arm.key)) {
        blip('beep', arm.x, y + 2, arm.z);
        stats.beeps++;
      }
    }
  }

  return {
    update,
    /** Para testes: estado do áudio e das vozes. */
    debug: () => ({
      on,
      state: ctx?.state ?? 'sem contexto',
      voices: voices.map((v) => (v.car ? { hz: Math.round(v.osc.frequency.value), gain: +v.gain.gain.value.toFixed(3), d: +v.car.d.toFixed(1), bus: !!v.car.bus } : null)),
      ...stats,
    }),
    start,
  };
}
