// Visitas com outros jogadores: quem está no mesmo imóvel se vê andando,
// sentado, interagindo ou conversando, e conversa pelo chat.
//
// A sala é a `interior` do realtime, uma por lote. Só entra o dono e quem ele
// convidou: o realtime confere no world com o token do próprio jogador.
import { loadAvatarAssets, makeAvatar } from './avatar.js';
import { interiorKey, realtimeFor } from './realtime-shard.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@colyseus/sdk@0.18.9/+esm';
const SEND_EVERY_MS = 150;
const MAX_LINES = 30;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ERRORS = {
  link: 'Links não são permitidos no chat.',
  too_long: 'Mensagem longa demais (até 200 caracteres).',
  empty: 'Mensagem vazia.',
  too_fast: 'Devagar: uma mensagem por segundo.',
  muted: 'Você está silenciado por um tempo.',
};

/** Sessão do mapa (mesma aba): o token do gateway. */
function session() {
  try {
    return JSON.parse(sessionStorage.getItem('scc-servidor-token') ?? 'null');
  } catch {
    return null;
  }
}

/**
 * @param {{ THREE, scene, city: string, lot: number, name: string, skin: string,
 *           loadGltf: (url: string) => Promise<any>,
 *           me: () => ({ x: number, z: number, rot: number, pose: string }) }} opts
 */
export function createInteriorMultiplayer(opts) {
  const { THREE, scene } = opts;
  const s = session();
  if (!s?.token || !Number.isInteger(opts.lot)) return null;

  // ─ Painel: quem está aqui e o chat ─
  const style = document.createElement('style');
  style.textContent = `
    .imp { position: fixed; right: 12px; bottom: 12px; width: 280px; max-width: calc(100vw - 24px); background: var(--panel); border: 1px solid var(--line);
      border-radius: 10px; padding: 8px 10px; font-size: 13px; z-index: 5; }
    .imp h2 { font-size: 13px; margin: 0 0 4px; display: flex; justify-content: space-between; }
    .imp ol { list-style: none; margin: 0 0 6px; padding: 0; max-height: 140px; overflow-y: auto; display: grid; gap: 2px; }
    .imp .meu b { color: var(--accent); }
    .imp form { display: flex; gap: 6px; }
    .imp input { flex: 1; min-width: 0; background: rgba(0,0,0,.25); border: 1px solid var(--line); border-radius: 6px; padding: 5px 7px; color: var(--text); }
    .imp button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 9px; cursor: pointer; }
    .imp .status { color: var(--muted); font-size: 12px; margin: 4px 0 0; }
    @media (max-width: 640px) { .imp { bottom: 110px; width: 220px; } .imp ol { max-height: 80px; } }
  `;
  document.head.append(style);
  const panel = document.createElement('aside');
  panel.className = 'imp';
  panel.setAttribute('aria-label', 'Quem está no imóvel');
  panel.innerHTML = `<h2><span>💬 Aqui dentro</span><span class="status" data-count></span></h2>
    <ol data-chat aria-live="polite"></ol>
    <form data-form><input name="text" maxlength="200" autocomplete="off" placeholder="Fale com quem está aqui…" aria-label="Mensagem" /><button type="submit">Enviar</button></form>
    <p class="status" data-status>Conectando…</p>`;
  document.body.append(panel);
  const chatEl = panel.querySelector('[data-chat]');
  const status = (t) => (panel.querySelector('[data-status]').textContent = t);
  const line = (html, cls = '') => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = html;
    chatEl.append(li);
    while (chatEl.children.length > MAX_LINES) chatEl.firstElementChild.remove();
    chatEl.scrollTop = chatEl.scrollHeight;
  };
  // Teclas digitadas no chat não andam com o avatar.
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  panel.addEventListener('keyup', (e) => e.stopPropagation());

  // ─ Os outros: avatar do tipo de cada um, com o nome em cima ─
  const group = new THREE.Group();
  group.name = 'visitantes';
  scene.add(group);
  const others = new Map(); // sessionId → { x, z, rot, pose, skin, name, inst?, obj?, loading? }
  /** m: altura do colchão para quem está deitado (pose `lie`). */
  const LIE_HEIGHT = 0.52;

  function label(text) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = '600 28px system-ui, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 28;
    c.width = w;
    c.height = 44;
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(15,23,42,.82)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, 44, 14);
    ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.fillText(text, 14, 31);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set((w / 44) * 0.1, 0.1, 1);
    sp.position.y = 1.95;
    sp.renderOrder = 10;
    return sp;
  }

  function build(o) {
    const skin = o.skin;
    o.loading = true;
    loadAvatarAssets(opts.loadGltf, skin)
      .then((assets) => {
        if (!others.has(o.id) || o.skin !== skin) return;
        if (o.obj) group.remove(o.obj);
        o.inst = makeAvatar(THREE, assets);
        o.obj = new THREE.Group();
        o.obj.add(o.inst.body, label(o.name));
        o.obj.position.set(o.x, 0, o.z);
        o.obj.rotation.y = o.rot;
        o.shownPose = null;
        group.add(o.obj);
      })
      .finally(() => {
        o.loading = false;
      });
  }

  /** Animação pela pose recebida; sentar e interagir tocam a entrada uma vez. */
  function showPose(o) {
    if (!o.inst || o.shownPose === o.pose) return;
    const before = o.shownPose;
    o.shownPose = o.pose;
    // Deitado: corpo girado no colchão, com o parado devagar (a UAL não tem clipe de deitar).
    const lying = o.pose === 'lie';
    o.inst.body.rotation.x = lying ? -Math.PI / 2 : 0;
    o.inst.body.position.y = lying ? LIE_HEIGHT : 0;
    o.inst.mixer.timeScale = lying ? 0.45 : 1;
    if (lying) return o.inst.play('idle');
    if (o.pose === 'sit') {
      if (before === 'sit') return;
      o.inst.playOnce('sitEnter', () => o.pose === 'sit' && o.inst.play('sit'));
    } else if (o.pose === 'interact') {
      o.inst.playOnce('interact', () => o.pose === 'interact' && o.inst.play('idle'));
    } else if (before === 'sit') {
      o.inst.playOnce('sitExit', () => o.inst.play(o.pose));
    } else o.inst.play(o.pose);
  }

  function sync(state) {
    const alive = new Set();
    let count = 0;
    state.players.forEach((p, id) => {
      count++;
      if (id === room?.sessionId) return;
      alive.add(id);
      let o = others.get(id);
      if (!o) {
        o = { id, name: `${p.name}${p.role === 'owner' ? ' (dono)' : ''}`, x: p.x, z: p.z };
        others.set(id, o);
      }
      Object.assign(o, { x: p.x, z: p.z, rot: p.rot, pose: p.pose });
      if (o.skin !== p.skin) {
        o.skin = p.skin;
        if (!o.loading) build(o);
      }
    });
    for (const [id, o] of others) {
      if (alive.has(id)) continue;
      if (o.obj) group.remove(o.obj);
      others.delete(id);
    }
    panel.querySelector('[data-count]').textContent = count === 1 ? 'só você' : `${count} pessoas`;
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const o of others.values()) {
      if (!o.obj) continue;
      const dx = o.x - o.obj.position.x, dz = o.z - o.obj.position.z;
      const gap = Math.hypot(dx, dz);
      // Sentado: vai direto ao assento. Andando: segue na velocidade de caminhada.
      if (o.pose === 'sit' || gap > 6) o.obj.position.set(o.x, 0, o.z);
      else if (gap > 0.01) {
        const step = Math.min(gap, Math.max(o.pose === 'run' ? 4.2 : 1.6, gap * 4) * dt);
        o.obj.position.x += (dx / gap) * step;
        o.obj.position.z += (dz / gap) * step;
      }
      const d = Math.atan2(Math.sin(o.rot - o.obj.rotation.y), Math.cos(o.rot - o.obj.rotation.y));
      o.obj.rotation.y += o.pose === 'sit' ? d : d * Math.min(1, dt * 10);
      showPose(o);
      o.inst.mixer.update(dt);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ─ Sala ─
  let room = null;
  let sent = null;
  (async () => {
    try {
      const sdk = await import(SDK);
      // O interior do lote vai para o processo do lote (?realtime=a,b,c, E3.9).
      const client = new sdk.Client(realtimeFor(interiorKey(opts.city, opts.lot)));
      client.auth.token = s.token;
      room = await client.joinOrCreate('interior', { city: opts.city, lot: opts.lot, name: opts.name, skin: opts.skin });
      status('');
      line('<span class="status">Você entrou. Quem estiver aqui aparece na sala.</span>');
      room.onStateChange((st) => sync(st));
      room.onMessage('chat', (m) => line(`<b>${esc(m.name)}</b> ${esc(m.text)}`, m.from === room.sessionId ? 'meu' : ''));
      room.onMessage('chat_error', (e) => status(ERRORS[e.reason] ?? 'Mensagem recusada.'));
      room.onLeave(() => {
        room = null;
        status('A conexão com a sala caiu.');
      });
      setInterval(() => {
        if (!room) return;
        const m = { ...opts.me(), skin: opts.skin };
        const changed =
          !sent || m.pose !== sent.pose || Math.hypot(m.x - sent.x, m.z - sent.z) > 0.03 || Math.abs(m.rot - sent.rot) > 0.05;
        if (!changed) return;
        room.send('move', m);
        sent = m;
      }, SEND_EVERY_MS);
    } catch (error) {
      status(error?.code === 403 || /not_invited/.test(String(error?.message)) ? 'Sem convite para a sala deste imóvel.' : `Sem conexão com o multiplayer (${realtimeFor(interiorKey(opts.city, opts.lot))}).`);
      console.warn('interior', error);
    }
  })();

  panel.querySelector('[data-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.text;
    const text = input.value.trim();
    if (!text || !room) return;
    room.send('chat', { text });
    input.value = '';
    status('');
  });

  return {
    room: () => room,
    others: () => [...others.values()].map((o) => ({ id: o.id, name: o.name, x: o.x, z: o.z, pose: o.pose, skin: o.skin, shown: !!o.obj })),
  };
}
