/**
 * Ligação entre o SCC Builder e o mapa da Smart Chain City.
 *
 * O editor abre o mapa numa janela e entrega o prédio por postMessage:
 *
 *   editor ── scc-builder:ping ──▶ mapa        (repete até o mapa responder)
 *   editor ◀── scc-map:ready ───── mapa
 *   editor ── scc-builder:model ─▶ mapa        (LOD0/1/2 como ArrayBuffer transferido)
 *   editor ◀── scc-map:received ── mapa        ({ ok, triangles, valid } ou { ok:false, error })
 *
 * Nada passa pela rede: o arquivo vai de uma aba para a outra. Cada lado só
 * aceita mensagem da origem que conhece — o editor, da origem do mapa
 * configurado; o mapa, da lista de origens do SCC Builder no main.js dele.
 */

export const MAP_MESSAGES = Object.freeze({
  PING: 'scc-builder:ping',
  READY: 'scc-map:ready',
  MODEL: 'scc-builder:model',
  RECEIVED: 'scc-map:received',
});

/** Versão do formato da mensagem; o mapa recusa versão que não conhece. */
export const MAP_PROTOCOL_VERSION = 1;

/** O protótipo da cidade, servido pela raiz do monorepo (launch "scc-telas"). */
export const DEV_MAP_URL = 'http://localhost:8081/docs/proposta-cidade-realista/index.html';

/**
 * Endereço do mapa: VITE_SCC_MAP_URL, ou o protótipo local em desenvolvimento.
 *
 * @param {Record<string, any>} env import.meta.env
 * @returns {string} vazio quando não há mapa configurado
 */
export function resolveMapUrl(env = {}) {
  const configurado = String(env.VITE_SCC_MAP_URL ?? '').trim();
  if (configurado) return configurado;

  return env.DEV ? DEV_MAP_URL : '';
}

/** @param {string} url */
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Monta a mensagem do modelo. Os buffers vão na lista de transferência:
 * o editor entrega a posse e não copia megabytes entre as abas.
 *
 * @param {{name: string, files: Array<{level: number, triangles: number, bytes: Uint8Array}>, report?: object}} pacote
 * @returns {{message: object, transfer: ArrayBuffer[]}}
 */
export function buildModelMessage(pacote) {
  const files = pacote.files.map((f) => {
    // Uint8Array pode ser uma janela de um buffer maior: copia só o trecho.
    const bytes =
      f.bytes.byteOffset === 0 && f.bytes.byteLength === f.bytes.buffer.byteLength
        ? f.bytes.buffer
        : f.bytes.slice().buffer;

    return {
      level: f.level,
      triangles: f.triangles,
      name: `${pacote.name}-lod${f.level}.glb`,
      bytes,
    };
  });

  return {
    message: {
      type: MAP_MESSAGES.MODEL,
      version: MAP_PROTOCOL_VERSION,
      name: pacote.name,
      units: 'm',
      upAxis: 'y',
      files,
      report: pacote.report ?? null,
    },
    transfer: files.map((f) => f.bytes),
  };
}

/**
 * Entrega o modelo a uma janela do mapa e espera a confirmação.
 *
 * @param {{postMessage: Function, closed?: boolean}} alvo janela aberta com window.open
 * @param {string} mapOrigin origem esperada do mapa
 * @param {{message: object, transfer: ArrayBuffer[]}} envio
 * @param {{win?: Window, timeoutMs?: number, intervalMs?: number}} [options]
 * @returns {Promise<{ok: boolean, [k: string]: any}>}
 */
export function deliverToMap(alvo, mapOrigin, envio, options = {}) {
  const win = options.win ?? globalThis.window;
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 400;

  return new Promise((resolve, reject) => {
    let enviado = false;

    const terminar = (fn, valor) => {
      clearInterval(ping);
      clearTimeout(limite);
      win.removeEventListener('message', ouvir);
      fn(valor);
    };

    const ouvir = (event) => {
      if (event.origin !== mapOrigin || event.source !== alvo) return;
      const tipo = event.data?.type;

      if (tipo === MAP_MESSAGES.READY && !enviado) {
        enviado = true;
        alvo.postMessage(envio.message, mapOrigin, envio.transfer);
      } else if (tipo === MAP_MESSAGES.RECEIVED) {
        terminar(resolve, event.data);
      }
    };

    win.addEventListener('message', ouvir);

    const ping = setInterval(() => {
      if (alvo.closed) {
        terminar(reject, Object.assign(new Error('map_closed'), { code: 'map_closed' }));
        return;
      }
      if (!enviado)
        alvo.postMessage({ type: MAP_MESSAGES.PING, version: MAP_PROTOCOL_VERSION }, mapOrigin);
    }, intervalMs);

    const limite = setTimeout(
      () => terminar(reject, Object.assign(new Error('map_timeout'), { code: 'map_timeout' })),
      timeoutMs
    );
  });
}
