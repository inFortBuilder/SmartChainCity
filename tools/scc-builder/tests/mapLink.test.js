import { describe, expect, it, vi } from 'vitest';

import {
  DEV_MAP_URL,
  MAP_MESSAGES,
  buildModelMessage,
  deliverToMap,
  originOf,
  resolveMapUrl,
} from '../src/utils/mapLink.js';

describe('resolveMapUrl', () => {
  it('usa VITE_SCC_MAP_URL quando definido', () => {
    expect(resolveMapUrl({ VITE_SCC_MAP_URL: ' https://mapa.exemplo/ ' })).toBe(
      'https://mapa.exemplo/'
    );
  });

  it('cai no protótipo local só em desenvolvimento', () => {
    expect(resolveMapUrl({ DEV: true })).toBe(DEV_MAP_URL);
    expect(resolveMapUrl({ DEV: false })).toBe('');
  });
});

describe('originOf', () => {
  it('extrai a origem e tolera URL inválida', () => {
    expect(originOf('http://localhost:8081/docs/x/index.html')).toBe('http://localhost:8081');
    expect(originOf('não é url')).toBe('');
  });
});

describe('buildModelMessage', () => {
  it('nomeia os LODs e transfere os buffers', () => {
    const lod0 = new Uint8Array([1, 2, 3]);
    const grande = new Uint8Array([9, 9, 4, 5, 9]);
    const janela = grande.subarray(2, 4);
    const { message, transfer } = buildModelMessage({
      name: 'torre',
      files: [
        { level: 0, triangles: 10, bytes: lod0 },
        { level: 1, triangles: 3, bytes: janela },
      ],
    });

    expect(message.type).toBe(MAP_MESSAGES.MODEL);
    expect(message.version).toBe(1);
    expect(message.units).toBe('m');
    expect(message.files.map((f) => f.name)).toEqual(['torre-lod0.glb', 'torre-lod1.glb']);
    expect(transfer[0]).toBe(lod0.buffer);
    // Uma janela de buffer maior é copiada: só o trecho vai para o mapa.
    expect([...new Uint8Array(transfer[1])]).toEqual([4, 5]);
  });
});

/** Janela do editor e do mapa de mentira, com postMessage síncrono. */
function cenario({ origemMapa = 'http://localhost:8081', responde = true } = {}) {
  const ouvintes = new Set();
  const win = {
    addEventListener: (_t, fn) => ouvintes.add(fn),
    removeEventListener: (_t, fn) => ouvintes.delete(fn),
  };
  const recebidas = [];
  const mapa = {
    closed: false,
    postMessage(msg, origem, transfer) {
      recebidas.push({ msg, origem, transfer });
      if (!responde) return;
      const responder = (data) =>
        ouvintes.forEach((fn) => fn({ origin: origemMapa, source: mapa, data }));
      if (msg.type === MAP_MESSAGES.PING) responder({ type: MAP_MESSAGES.READY });
      if (msg.type === MAP_MESSAGES.MODEL)
        responder({ type: MAP_MESSAGES.RECEIVED, ok: true, valid: true });
    },
  };
  return { win, mapa, recebidas };
}

describe('deliverToMap', () => {
  it('faz ping, espera o mapa e entrega o modelo uma vez', async () => {
    vi.useFakeTimers();
    const { win, mapa, recebidas } = cenario();
    const envio = buildModelMessage({
      name: 't',
      files: [{ level: 0, triangles: 1, bytes: new Uint8Array(4) }],
    });

    const promessa = deliverToMap(mapa, 'http://localhost:8081', envio, { win, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(350);
    const resposta = await promessa;
    vi.useRealTimers();

    expect(resposta).toMatchObject({ ok: true, valid: true });
    const tipos = recebidas.map((r) => r.msg.type);
    expect(tipos.filter((t) => t === MAP_MESSAGES.MODEL)).toHaveLength(1);
    expect(recebidas.every((r) => r.origem === 'http://localhost:8081')).toBe(true);
    expect(recebidas.find((r) => r.msg.type === MAP_MESSAGES.MODEL).transfer).toBe(envio.transfer);
  });

  it('ignora resposta de outra origem e estoura o tempo', async () => {
    vi.useFakeTimers();
    const { win, mapa } = cenario({ origemMapa: 'https://intruso.exemplo' });
    const envio = buildModelMessage({
      name: 't',
      files: [{ level: 0, triangles: 1, bytes: new Uint8Array(4) }],
    });

    const promessa = deliverToMap(mapa, 'http://localhost:8081', envio, {
      win,
      timeoutMs: 1000,
      intervalMs: 100,
    });
    const verificacao = expect(promessa).rejects.toMatchObject({ code: 'map_timeout' });
    await vi.advanceTimersByTimeAsync(1100);
    await verificacao;
    vi.useRealTimers();
  });

  it('avisa quando a janela do mapa foi fechada', async () => {
    vi.useFakeTimers();
    const { win, mapa } = cenario({ responde: false });
    mapa.closed = true;
    const envio = buildModelMessage({
      name: 't',
      files: [{ level: 0, triangles: 1, bytes: new Uint8Array(4) }],
    });

    const promessa = deliverToMap(mapa, 'http://localhost:8081', envio, { win, intervalMs: 100 });
    const verificacao = expect(promessa).rejects.toMatchObject({ code: 'map_closed' });
    await vi.advanceTimersByTimeAsync(150);
    await verificacao;
    vi.useRealTimers();
  });
});
