// Multiplayer no mapa (E2.7): quem está no mesmo bairro aparece como um alfinete
// com o nome, e o chat do bairro fica num painel. A sala é a do serviço realtime
// (services/realtime, Colyseus): uma por bairro, até 100 jogadores.
//
// "Onde estou" é para onde a câmera olha (o alvo dos controles) ou, no street view,
// onde o avatar está. Mudou de bairro, troca de sala sozinho.
//
// No mapa, cada jogador é um alfinete. No street view, quem também está na rua
// aparece como avatar, com o mesmo modelo e a animação pela velocidade.
import { getAvatarType, isAvatarType, makeAvatar } from './avatar.js';
import { REALTIME_URLS, districtKey, realtimeFor } from './realtime-shard.js';


// Um ou mais processos do realtime (?realtime=a,b,c): cada bairro vai sempre para o mesmo (E3.9).
const REALTIME = REALTIME_URLS[0];
const SDK = 'https://cdn.jsdelivr.net/npm/@colyseus/sdk@0.18.9/+esm';
const CITY = 'pittsburg';
const MOVE_EVERY_MS = 200;
const MAX_LINES = 40;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const ERRORS = {
  link: 'Links não são permitidos no chat.',
  too_long: 'Mensagem longa demais (até 200 caracteres).',
  empty: 'Mensagem vazia.',
  too_fast: 'Devagar: uma mensagem por segundo.',
  muted: 'Você está silenciado por um tempo.',
};

/**
 * @param {{ THREE, scene, camera, controls, lotAt: (x:number,z:number)=>number|null,
 *           getLots: ()=>any, getSession: ()=>({token:string,address?:string}|null),
 *           getAvatar: ()=>any, getStreetView?: ()=>any }} map
 */
export function createMultiplayer(map) {
  const { THREE, scene, controls } = map;

  // ─ Painel do bairro: quantos estão aqui e o chat ─
  const panel = document.createElement('aside');
  panel.className = 'multiplayer glass';
  panel.setAttribute('aria-label', 'Jogadores no bairro');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="linha cab"><h2>💬 Bairro <span data-mp-bairro>—</span></h2><span class="muted pequeno" data-mp-count></span></div>
    <ol class="mp-chat" data-mp-chat aria-live="polite"></ol>
    <form class="linha" data-mp-form>
      <input class="campo" name="text" maxlength="200" autocomplete="off" placeholder="Fale com o bairro…" aria-label="Mensagem para o bairro" />
      <button class="btn" type="submit">Enviar</button>
    </form>
    <p class="muted pequeno" data-mp-status></p>`;
  document.body.append(panel);
  const chatEl = panel.querySelector('[data-mp-chat]');
  const statusEl = panel.querySelector('[data-mp-status]');

  const line = (html, cls = '') => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = html;
    chatEl.append(li);
    while (chatEl.children.length > MAX_LINES) chatEl.firstElementChild.remove();
    chatEl.scrollTop = chatEl.scrollHeight;
  };
  const status = (text) => (statusEl.textContent = text);

  // ─ Alfinetes dos outros jogadores ─
  const group = new THREE.Group();
  group.name = 'jogadores';
  scene.add(group);
  const pins = new Map(); // sessionId → { obj, x, z }
  const pinGeo = new THREE.CylinderGeometry(4, 0.5, 60, 10);
  pinGeo.translate(0, 30, 0);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });

  function labelSprite(text) {
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
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
    s.scale.set((w / 44) * 0.035, 0.035, 1);
    s.position.y = 75;
    s.renderOrder = 10;
    return s;
  }

  // Nome pequeno sobre o avatar no street view (em metros, diminui com a distância).
  function streetLabel(text) {
    const s = labelSprite(text);
    s.material.sizeAttenuation = true;
    const ratio = s.scale.x / s.scale.y;
    s.scale.set(0.32 * ratio, 0.32, 1);
    s.position.y = 2.15;
    return s;
  }

  // Avatar dos outros jogadores: o tipo que cada um escolheu (Man ou Woman), com os mesmos clipes.
  function makeWalker(pin, name) {
    const type = pin.skin;
    const assets = map.getStreetView?.()?.avatarAssets(type);
    if (!assets) return;
    pin.walker = { loading: true, type };
    assets
      .then((a) => {
        if (pins.get(pin.id) !== pin || pin.skin !== type) return;
        const inst = makeAvatar(THREE, a);
        const obj = new THREE.Group();
        obj.add(inst.body, streetLabel(name));
        obj.position.set(pin.x, map.getStreetView().groundY(), pin.z);
        obj.rotation.y = pin.rot;
        obj.visible = false;
        group.add(obj);
        pin.walker = { obj, mixer: inst.mixer, play: inst.play, type };
      })
      .catch(() => {
        pin.walker = null;
      });
  }

  function makePin(name) {
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(pinGeo, pinMat));
    obj.add(labelSprite(name));
    group.add(obj);
    return obj;
  }

  function removePin(pin) {
    pin.obj.traverse((o) => o.material?.map?.dispose?.());
    group.remove(pin.obj);
    if (pin.walker?.obj) group.remove(pin.walker.obj);
  }

  function dropPins() {
    for (const p of pins.values()) removePin(p);
    pins.clear();
  }

  function syncPins(state) {
    if (!room) return;
    const alive = new Set();
    let count = 0;
    state.players.forEach((p, id) => {
      count++;
      if (id === room.sessionId) return;
      alive.add(id);
      let pin = pins.get(id);
      if (!pin) {
        pin = { id, name: p.name, obj: makePin(p.name), x: p.x, z: p.z, rot: p.rot, walker: null };
        pins.set(id, pin);
      }
      pin.x = p.x;
      pin.z = p.z;
      pin.rot = p.rot;
      pin.mode = p.mode ?? 'map';
      pin.speed = p.speed ?? 0;
      pin.skin = isAvatarType(p.skin) ? p.skin : 'man';
      // Trocou de tipo: refaz o avatar.
      if (pin.walker && !pin.walker.loading && pin.walker.type !== pin.skin) {
        group.remove(pin.walker.obj);
        pin.walker = null;
      }
      if (pin.mode === 'street' && !pin.walker) makeWalker(pin, p.name);
    });
    for (const [id, pin] of pins) {
      if (alive.has(id)) continue;
      removePin(pin);
      pins.delete(id);
    }
    panel.querySelector('[data-mp-count]').textContent = count === 1 ? 'só você aqui' : `${count} jogadores aqui`;
  }

  /**
   * Desliza alfinetes e avatares até a posição nova (as mensagens chegam a cada
   * 200 ms). Eu no street view: vejo os avatares de quem está na rua. Eu no mapa:
   * vejo todos como alfinetes.
   */
  let lastTick = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    const street = !!map.getStreetView?.()?.active();
    for (const pin of pins.values()) {
      pin.obj.visible = !street;
      pin.obj.position.x += (pin.x - pin.obj.position.x) * 0.2;
      pin.obj.position.z += (pin.z - pin.obj.position.z) * 0.2;
      const w = pin.walker;
      if (!w?.obj) continue;
      w.obj.visible = street && pin.mode === 'street';
      if (!w.obj.visible) {
        w.obj.position.set(pin.x, w.obj.position.y, pin.z); // sem deslizar de longe quando reaparecer
        continue;
      }
      // Segue a posição recebida na velocidade de caminhada; longe demais, salta.
      const dx = pin.x - w.obj.position.x, dz = pin.z - w.obj.position.z;
      const gap = Math.hypot(dx, dz);
      if (gap > 30) w.obj.position.set(pin.x, w.obj.position.y, pin.z);
      else if (gap > 0.01) {
        const step = Math.min(gap, Math.max(pin.speed, gap * 4) * dt);
        w.obj.position.x += (dx / gap) * step;
        w.obj.position.z += (dz / gap) * step;
      }
      const d = Math.atan2(Math.sin(pin.rot - w.obj.rotation.y), Math.cos(pin.rot - w.obj.rotation.y));
      w.obj.rotation.y += d * Math.min(1, dt * 10);
      w.play(pin.speed > 2.5 ? 'run' : pin.speed > 0.2 || gap > 0.3 ? 'walk' : 'idle');
      w.mixer.update(dt);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ─ Sala ─
  let sdk = null;
  let room = null;
  let roomDistrict = null;
  let joining = false;
  let token = null;
  let lastSent = { x: NaN, z: NaN, mode: 'map', speed: 0, rot: 0 };

  const districtHere = () => {
    const lots = map.getLots();
    const t = controls.target;
    // Na rua não há lote embaixo: vale o lote mais perto, até 40 m.
    let i = map.lotAt(t.x, t.z);
    for (let r = 5; i === null && r <= 40; r += 5) {
      for (let k = 0; k < 8 && i === null; k++) i = map.lotAt(t.x + Math.cos((k / 8) * Math.PI * 2) * r, t.z + Math.sin((k / 8) * Math.PI * 2) * r);
    }
    if (i === null || !lots?.district) return null;
    return lots.district[i];
  };

  const myName = () => {
    const job = map.getAvatar()?.job?.label ?? 'Jogador';
    const addr = map.getSession()?.address;
    return addr ? `${job} ${addr.slice(-4)}` : job;
  };

  async function leave() {
    const r = room;
    room = null;
    roomDistrict = null;
    dropPins();
    if (r) await r.leave().catch(() => {});
  }

  async function join(district) {
    joining = true;
    try {
      sdk ??= await import(SDK);
      const client = new sdk.Client(realtimeFor(districtKey(CITY, district)));
      client.auth.token = token;
      const t = controls.target;
      const r = await client.joinOrCreate('district', { city: CITY, district, name: myName(), x: t.x, z: t.z });
      await leave();
      room = r;
      roomDistrict = district;
      lastSent = { x: t.x, z: t.z, mode: 'map', speed: 0, rot: 0 };
      panel.querySelector('[data-mp-bairro]').textContent = String(district + 1);
      chatEl.innerHTML = '';
      line(`<span class="muted">Você entrou no bairro ${district + 1}.</span>`);
      status('');
      r.onStateChange((s) => syncPins(s));
      r.onMessage('chat', (m) =>
        line(`<span class="muted">${hhmm(m.at)}</span> <b>${esc(m.name)}</b> ${esc(m.text)}`, m.from === r.sessionId ? 'meu' : ''),
      );
      r.onMessage('chat_error', (e) => status(ERRORS[e.reason] ?? 'Mensagem recusada.'));
      r.onMessage('event', (e) => line(`📣 <b>${esc(e.text)}</b>`, 'evento'));
      r.onMessage('report_ok', () => status('Denúncia registrada. Obrigado.'));
      r.onLeave(() => {
        if (room === r) {
          room = null;
          roomDistrict = null;
          dropPins();
          status('Conexão com o bairro caiu; tentando de novo…');
        }
      });
    } catch (error) {
      status(`Sem conexão com o multiplayer (${REALTIME}).`);
      console.warn('multiplayer', error);
    } finally {
      joining = false;
    }
  }

  // Laço: entra, troca de bairro e manda a posição.
  async function loop() {
    const session = map.getSession();
    if (!session) {
      if (room) await leave();
      panel.hidden = true;
      token = null;
      return;
    }
    panel.hidden = false;
    token = session.token;
    const district = districtHere() ?? roomDistrict;
    if (district === null || district === undefined) {
      status('Aproxime a câmera de um bairro para encontrar outros jogadores.');
      return;
    }
    if (!joining && district !== roomDistrict) {
      await join(district);
      return;
    }
    if (!room) return;
    const sv = map.getStreetView?.();
    if (sv?.active()) {
      // No street view, a posição é a do avatar, com o rumo do corpo e a velocidade.
      const p = sv.position();
      const msg = { x: p.x, z: p.z, rot: sv.bodyHeading(), mode: 'street', speed: sv.speed(), skin: getAvatarType() };
      const changed =
        lastSent.mode !== 'street' ||
        lastSent.skin !== msg.skin || Math.hypot(p.x - lastSent.x, p.z - lastSent.z) > 0.05 || msg.speed !== lastSent.speed || Math.abs(msg.rot - lastSent.rot) > 0.05;
      if (changed) {
        room.send('move', msg);
        lastSent = msg;
      }
      return;
    }
    const t = controls.target;
    if (lastSent.mode !== 'map' || Math.hypot(t.x - lastSent.x, t.z - lastSent.z) > 1) {
      const msg = { x: t.x, z: t.z, rot: Math.atan2(map.camera.position.x - t.x, map.camera.position.z - t.z), mode: 'map', speed: 0, skin: getAvatarType() };
      room.send('move', msg);
      lastSent = msg;
    }
  }
  setInterval(() => loop().catch((e) => console.warn('multiplayer', e)), MOVE_EVERY_MS);

  panel.querySelector('[data-mp-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.text;
    const text = input.value.trim();
    if (!text || !room) return;
    room.send('chat', { text });
    input.value = '';
    status('');
  });

  return {
    /** Quem está no bairro (para testes e para a tela). */
    players: () => [...pins.entries()].map(([id, p]) => ({ id, x: p.x, z: p.z, mode: p.mode, speed: p.speed, skin: p.skin, avatar: !!p.walker?.obj, visible: !!p.walker?.obj?.visible })),
    room: () => room,
    district: () => roomDistrict,
    report: (sessionId, reason = '') => room?.send('report', { sessionId, reason }),
  };
}
