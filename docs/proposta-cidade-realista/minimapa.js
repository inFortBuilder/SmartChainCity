// Minimapa e GPS do street view (fase 4 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// Minimapa: um círculo no canto com 160 m em volta do avatar, virado para onde a câmera olha (a frente é
// para cima). As ruas saem do próprio índice das ruas do street view (`isRoad`), amostradas a cada 1 m
// num quadro de 240 m, refeito quando o avatar se afasta 50 m do centro dele. Por cima: os carros (o
// ônibus maior), os pedestres, os pontos de ônibus, os semáforos na cor de agora, os lugares do jogo e a
// seta do avatar no centro.
//
// GPS: no seletor embaixo do minimapa, escolhe-se um lugar (Loja do jogo, Farmácia, Mercado). A rota sai
// do mesmo A* do clique de andar (caminho.js), numa grade de 2 m só pelas ruas, e é refeita a cada 3 s ou
// quando o avatar sai 15 m dela. No minimapa, a rota é a linha amarela; embaixo, a distância que falta.
// Chegando a 12 m do lugar, o GPS avisa e desliga.
//
// PREMISSAS: minimapa de 160 m (raio de 80 m) em 180 px; ruas amostradas a 1 m num quadro de 240 m;
// GPS numa grade de 2 m, até 150 mil nós; chegada a 12 m.

import { findPath } from './caminho.js';

export const MINIMAP = { px: 180, radius: 80, sample: 1, frame: 240, rebuildAt: 50 };
export const GPS = { cell: 2, clearance: 0, margin: 40, maxNodes: 150_000, sightStep: 1, every: 3, offRoute: 15, arrive: 12 };

/** Distância do ponto (x, z) até o segmento a–b. */
export function distToSegment(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/** Comprimento de uma rota a partir de (x, z). */
export const routeLength = (x, z, pts) => pts.reduce((s, p, i) => s + Math.hypot(p.x - (i ? pts[i - 1].x : x), p.z - (i ? pts[i - 1].z : z)), 0);

/** Rota pelas ruas de `from` até `to` (grade de 2 m), ou null. */
export const roadRoute = (isRoad, from, to, opt = GPS) => findPath(isRoad, from, to, opt);

export function createMinimap({ streetView, places = () => [], cars = () => [], peds = () => [], signals = () => null, opt = MINIMAP, gps = GPS }) {
  const style = document.createElement('style');
  style.textContent = `
    .mm { position: fixed; right: 16px; top: 64px; z-index: 7; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .mm[hidden] { display: none; }
    .mm canvas { width: ${opt.px}px; height: ${opt.px}px; border-radius: 50%; box-shadow: 0 4px 16px rgba(0,0,0,.35); border: 3px solid rgba(255,255,255,.85); }
    .mm select { border: 0; border-radius: 8px; padding: 5px 8px; font: 600 13px system-ui, sans-serif; max-width: ${opt.px + 20}px; }
    .mm .mm-gps { background: rgba(15,23,42,.88); color: #fff; border-radius: 999px; padding: 4px 10px; font: 600 12px system-ui, sans-serif; }
    .mm .mm-gps:empty { display: none; }
    @media (max-width: 640px) { .mm canvas { width: 120px; height: 120px; } }
  `;
  document.head.append(style);
  const box = document.createElement('div');
  box.className = 'mm';
  box.hidden = true;
  box.innerHTML = `<canvas width="${opt.px * 2}" height="${opt.px * 2}" aria-label="Minimapa"></canvas>
    <select aria-label="Destino do GPS"><option value="">GPS: sem destino</option></select>
    <span class="mm-gps" aria-live="polite"></span>`;
  document.body.append(box);
  const canvas = box.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const select = box.querySelector('select');
  const info = box.querySelector('.mm-gps');
  // Quadro das ruas (fora da tela), refeito quando o avatar se afasta.
  const roads = document.createElement('canvas');
  roads.width = roads.height = Math.round(opt.frame / opt.sample);
  let frame = null; // { x0, z0 } do canto do quadro
  let route = null; // { place, points, at, prev }: prev é o último ponto já passado (começo do trecho atual)
  const stats = { frames: 0, routes: 0, reroutes: 0, arrived: 0, failed: 0, ms: 0 };

  function fillPlaces() {
    const list = places();
    const have = [...select.options].map((o) => o.value);
    for (const p of list) {
      if (have.includes(p.id)) continue;
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      select.append(o);
    }
  }
  select.addEventListener('change', () => {
    route = null;
    info.textContent = '';
    if (select.value) plan(true);
  });
  // O seletor não pode mandar teclas para o avatar.
  select.addEventListener('keydown', (e) => e.stopPropagation());

  function rebuildRoads(cx, cz) {
    const n = roads.width;
    const g = roads.getContext('2d');
    const img = g.createImageData(n, n);
    const x0 = cx - opt.frame / 2, z0 = cz - opt.frame / 2;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const on = streetView.isRoad(x0 + (c + 0.5) * opt.sample, z0 + (r + 0.5) * opt.sample);
        const k = (r * n + c) * 4;
        // Rua cinza-clara sobre o fundo verde-escuro (quarteirão).
        img.data[k] = on ? 214 : 46;
        img.data[k + 1] = on ? 218 : 64;
        img.data[k + 2] = on ? 224 : 52;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    frame = { x0, z0 };
  }

  function plan(fresh = false) {
    const place = places().find((p) => p.id === select.value);
    if (!place) return;
    const a = streetView.position();
    const t0 = performance.now();
    const to = streetView.nearestRoad(place.x, place.z, 40) ?? place;
    const pts = roadRoute((x, z) => streetView.isRoad(x, z), { x: a.x, z: a.z }, to, gps);
    stats.ms = Math.round(performance.now() - t0);
    if (!pts) {
      stats.failed++;
      info.textContent = `${place.label}: sem rota daqui`;
      route = { place, points: [], at: performance.now(), prev: { x: a.x, z: a.z } };
      return;
    }
    // O último trecho vai da rua até a porta.
    pts.push({ x: place.x, z: place.z });
    route = { place, points: pts, at: performance.now(), prev: { x: a.x, z: a.z } };
    stats[fresh ? 'routes' : 'reroutes']++;
  }

  function draw() {
    const a = streetView.position();
    if (!frame || Math.hypot(a.x - (frame.x0 + opt.frame / 2), a.z - (frame.z0 + opt.frame / 2)) > opt.rebuildAt) rebuildRoads(a.x, a.z);
    const W = canvas.width, s = W / (opt.radius * 2); // px por metro
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#2e4034';
    ctx.fillRect(0, 0, W, W);
    // Frente para cima: gira o mundo pelo rumo da câmera.
    ctx.translate(W / 2, W / 2);
    ctx.rotate(streetView.heading() - Math.PI);
    const P = (x, z) => [(x - a.x) * s, (z - a.z) * s];
    ctx.imageSmoothingEnabled = false;
    const [rx, rz] = P(frame.x0, frame.z0);
    ctx.drawImage(roads, rx, rz, opt.frame * s, opt.frame * s);
    // Rota do GPS.
    if (route?.points.length) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 6;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (const p of route.points) ctx.lineTo(...P(p.x, p.z));
      ctx.stroke();
    }
    const dot = (x, z, r, color, square = false) => {
      const [px, pz] = P(x, z);
      if (Math.hypot(px, pz) > W / 2 + 10) return;
      ctx.fillStyle = color;
      if (square) ctx.fillRect(px - r, pz - r, r * 2, r * 2);
      else {
        ctx.beginPath();
        ctx.arc(px, pz, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    for (const p of peds()) dot(p.x, p.z, 2.5, '#cbd5e1');
    for (const st of streetView.busStops?.() ?? []) dot(st.x, st.z, 5, '#2563eb', true);
    for (const arm of signals()?.arms?.() ?? []) dot(arm.x, arm.z, 4, arm.state === 'green' ? '#22c55e' : arm.state === 'yellow' ? '#f59e0b' : '#ef4444');
    for (const c of cars()) dot(c.x, c.z, c.bus ? 7 : 4.5, c.bus ? '#16a34a' : '#f97316');
    for (const p of places()) dot(p.x, p.z, 6, p.id === route?.place.id ? '#facc15' : '#a855f7', true);
    ctx.restore();
    // Seta do avatar, sempre no centro e para cima (o mapa é que gira).
    ctx.save();
    ctx.translate(W / 2, W / 2);
    const turn = streetView.bodyHeading() - streetView.heading();
    ctx.rotate(-turn);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 10);
    ctx.lineTo(0, 4);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Norte no anel.
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(streetView.heading() - Math.PI);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -W / 2 + 24);
    ctx.restore();
    stats.frames++;
  }

  let last = 0;
  function update() {
    const on = streetView.active();
    box.hidden = !on;
    if (!on) return;
    const now = performance.now();
    // 15 quadros por segundo bastam para o minimapa.
    if (now - last < 66) return;
    last = now;
    fillPlaces();
    if (route) {
      const a = streetView.position();
      const pts = route.points;
      if (pts.length) {
        // Fora da rota: longe do trecho atual (do último ponto passado ao próximo) e dos seguintes.
        const off = Math.min(distToSegment(a.x, a.z, route.prev, pts[0]), ...pts.slice(1).map((p, i) => distToSegment(a.x, a.z, pts[i], p)));
        const goal = pts[pts.length - 1];
        const left = Math.hypot(goal.x - a.x, goal.z - a.z);
        if (left < gps.arrive) {
          stats.arrived++;
          info.textContent = `Chegou: ${route.place.label}`;
          route = null;
          select.value = '';
          setTimeout(() => { if (!route) info.textContent = ''; }, 3000);
        } else {
          // Tira da rota os pontos que já ficaram para trás (o mais perto vira o primeiro).
          let k = 0;
          for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i].x - a.x, pts[i].z - a.z) < Math.hypot(pts[k].x - a.x, pts[k].z - a.z)) k = i;
          if (k > 0) route.prev = pts.splice(0, k)[k - 1];
          info.textContent = `${route.place.label} · ${Math.round(routeLength(a.x, a.z, pts))} m`;
          if (off > gps.offRoute || now - route.at > gps.every * 1000) plan();
        }
      } else if (now - route.at > gps.every * 1000) plan();
    }
    draw();
  }

  return {
    update,
    /** Liga o GPS para o lugar (o mesmo do seletor). */
    go: (id) => {
      fillPlaces();
      select.value = id;
      select.dispatchEvent(new Event('change'));
    },
    debug: () => ({
      visible: !box.hidden,
      route: route && { place: route.place.id, points: route.points.length, path: route.points.map((p) => [p.x, p.z]), length: Math.round(routeLength(streetView.position().x, streetView.position().z, route.points)) },
      info: info.textContent,
      options: [...select.options].map((o) => o.value).filter(Boolean),
      ...stats,
    }),
  };
}
