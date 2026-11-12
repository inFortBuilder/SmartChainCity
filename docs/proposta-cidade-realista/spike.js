// Medição do spike do cliente web (E0.9, ADR-0009). Abra o mapa com ?spike
// (ou ?spike=20 para o número de prédios) e espere o painel: ele põe prédios
// de jogadores com LOD progressivo perto do centro e mede o que a ADR pede.
//
// Critérios: 60 FPS em notebook médio · 30 FPS em celular médio · download
// inicial ≤ 10 MB · 20 prédios GLB de jogadores com LOD.

const MB = 1e6;
const sum = (list) => list.reduce((s, v) => s + v, 0);

/** Bytes baixados até agora, por arquivo (Resource Timing). */
export function downloaded() {
  const entries = performance.getEntriesByType('resource');
  const files = entries.map((e) => ({ name: e.name.split('/').pop().split('?')[0], bytes: e.encodedBodySize || e.transferSize || 0 }));
  return { total: sum(files.map((f) => f.bytes)), files };
}

/** Quadros por segundo e tempo de quadro durante `seconds`, com triângulos e chamadas do último quadro. */
export function measureFrames(renderer, seconds = 5) {
  return new Promise((resolve) => {
    const times = [];
    let last = performance.now();
    const start = last;
    const step = (now) => {
      times.push(now - last);
      last = now;
      if (now - start < seconds * 1000) requestAnimationFrame(step);
      else {
        const sorted = [...times].sort((a, b) => a - b);
        resolve({
          fps: times.length / seconds,
          frameMs: sum(times) / times.length,
          p95Ms: sorted[Math.floor(sorted.length * 0.95)],
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        });
      }
    };
    requestAnimationFrame(step);
  });
}

/**
 * Põe `count` prédios numa grade em volta de `center`, cada um com os LODs de
 * `files` (o mais detalhado primeiro). Usa o mesmo carregador progressivo do
 * Centro Administrativo: chega o LOD leve e os outros só de perto.
 */
export function placeBuildings(api, files, center, count = 20, spacing = 160) {
  const cols = Math.ceil(Math.sqrt(count));
  const list = [];
  for (let k = 0; k < count; k++) {
    const x = center[0] + ((k % cols) - (cols - 1) / 2) * spacing;
    const z = center[1] + (Math.floor(k / cols) - (Math.ceil(count / cols) - 1) / 2) * spacing + 400;
    list.push(api.progressiveBuilding(files, [x, z], (k * Math.PI) / 7));
  }
  return list;
}

function panel() {
  const el = document.createElement('div');
  el.className = 'glass';
  el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9;padding:12px 14px;border-radius:12px;font:12px/1.5 system-ui;max-width:340px';
  document.body.append(el);
  return (html) => {
    el.innerHTML = html;
  };
}

const ok = (pass) => (pass ? '✅' : '❌');

/** Roda o roteiro completo e devolve os números (também ficam em window.__spikeResult). */
export async function runSpike(api, { count = 20, files }) {
  const show = panel();
  const initial = downloaded();
  show('Spike E0.9: medindo a cidade sem prédios…');
  const city = await api.measureFrames(5);

  show(`Spike E0.9: pondo ${count} prédios…`);
  const buildings = placeBuildings(api, files, api.center, count);
  await Promise.all(buildings.map((b) => b.ready));
  // Câmera de onde se veem todos, com os mais próximos dentro do LOD0.
  api.lookAt(api.center[0], api.center[1] + 400, 900);
  // Espera os LODs e a resolução adaptativa assentarem antes de medir.
  await new Promise((r) => setTimeout(r, 5000));
  await Promise.all(buildings.filter((b) => b.upgraded).map((b) => b.upgrade()));
  const withBuildings = await api.measureFrames(5);
  const levels = buildings.map((b) => b.levelsLoaded());

  const result = {
    gpu: api.gpu(),
    dpr: devicePixelRatio,
    viewport: `${innerWidth}×${innerHeight}`,
    cpus: navigator.hardwareConcurrency ?? null,
    memoriaGB: navigator.deviceMemory ?? null,
    initialMB: initial.total / MB,
    totalMB: downloaded().total / MB,
    city,
    withBuildings,
    buildings: count,
    buildingsWithAllLods: levels.filter((n) => n === files.length).length,
    quality: api.quality?.() ?? null,
  };
  window.__spikeResult = result;
  const f = (v, d = 1) => v.toFixed(d).replace('.', ',');
  show(`<strong>Spike E0.9 — cliente web</strong><br>
    GPU: ${result.gpu}<br>Tela: ${result.viewport} · DPR ${result.dpr}<br>
    ${ok(result.initialMB <= 10)} Download inicial: ${f(result.initialMB, 2)} MB (meta ≤ 10)<br>
    Cidade: ${f(city.fps)} FPS · quadro ${f(city.frameMs)} ms (p95 ${f(city.p95Ms)})<br>
    ${ok(withBuildings.fps >= 30)} Com ${count} prédios: ${f(withBuildings.fps)} FPS · quadro ${f(withBuildings.frameMs)} ms (p95 ${f(withBuildings.p95Ms)})<br>
    ${f(withBuildings.triangles / 1e6, 2)} mi triângulos · ${withBuildings.calls} chamadas · ${result.buildingsWithAllLods} de ${count} com todos os LODs<br>
    Total baixado: ${f(result.totalMB, 2)} MB<br>
    ${result.quality ? `Perfil: depth ${result.quality.profundidade} · resolução ${f(result.quality.escala, 2)}× ${result.quality.adaptativa ? "(adaptativa)" : "(fixa)"} · malhas ${result.quality.juntar ? "juntadas" : "separadas"}${result.quality.limiteDaTela ? " · ⚠️ FPS travado pelo aparelho (ex.: Modo de Pouca Energia)" : ""}<br>` : ""}
    <span class="muted">Meta: 60 FPS em notebook médio, 30 FPS em celular médio. O FPS trava na taxa da tela.</span>
    <div data-spike-envio class="muted">Enviando o resultado…</div>`);
  // Com o servidor de desenvolvimento, o resultado volta para o PC que serve o
  // mapa (.local/spike/resultados.jsonl): dá para medir no celular sem print.
  const status = document.querySelector('[data-spike-envio]');
  fetch('spike-resultado.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) })
    .then((r) => {
      status.textContent = r.ok ? '✅ Resultado enviado para o PC.' : 'Resultado não enviado: este servidor não grava.';
    })
    .catch(() => {
      status.textContent = 'Resultado não enviado: este servidor não grava.';
    });
  return result;
}
