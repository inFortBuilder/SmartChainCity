/**
 * Cliente da API REST do SCC Builder.
 *
 * A v1 tinha `fetch('/scc-builder/api/convert.php')` codificado no meio do
 * main.js — quebrava em qualquer deploy fora de /scc-builder/. Aqui a base
 * vem de VITE_API_BASE_URL, com fallback para o caminho relativo à página.
 *
 * O `code` do erro é o da API e não se traduz; a mensagem vai para a tela.
 */
import { t } from '../i18n/index.js';

/**
 * JWT do jogador, emitido pelo gateway SCC (login SIWE).
 *
 * O jogo abre o editor com `#token=<jwt>`: o fragmento não vai ao servidor
 * nem aos logs de acesso. Lido uma vez, sai da barra de endereço e fica no
 * sessionStorage da aba — fechou a aba, acabou. Em desenvolvimento,
 * VITE_SCC_TOKEN serve de atalho.
 */
export function readSessionToken(win = globalThis.window) {
  const KEY = 'scc_builder_token';

  try {
    const hash = win?.location?.hash ?? '';
    const match = /(?:^#|&)token=([^&]+)/.exec(hash);
    if (match) {
      const token = decodeURIComponent(match[1]);
      win.sessionStorage?.setItem(KEY, token);
      win.history?.replaceState(null, '', win.location.pathname + win.location.search);

      return token;
    }

    return win?.sessionStorage?.getItem(KEY) ?? import.meta.env?.VITE_SCC_TOKEN ?? '';
  } catch {
    return import.meta.env?.VITE_SCC_TOKEN ?? '';
  }
}

const DEFAULT_BASE = (() => {
  const configured = import.meta.env?.VITE_API_BASE_URL;
  if (configured) return String(configured).replace(/\/$/, '');

  const base = import.meta.env?.BASE_URL ?? '/';

  return `${base.replace(/\/$/, '')}/api`;
})();

export class SccBuilderApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} status
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, status, details = {}) {
    super(message);
    this.name = 'SccBuilderApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class SccBuilderClient {
  /**
   * @param {{baseUrl?: string, token?: string, apiKey?: string, timeout?: number}} [options]
   *   token: JWT do jogador (Authorization: Bearer). apiKey: só para desenvolvimento
   *   local — no browser de produção ela vazaria para qualquer visitante.
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.token = options.token ?? '';
    this.apiKey = options.apiKey ?? import.meta.env?.VITE_API_KEY ?? '';
    this.timeout = options.timeout ?? 120_000;
  }

  get configured() {
    return this.token !== '' || this.apiKey !== '';
  }

  #headers(extra = {}) {
    const headers = { ...extra };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    else if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    return headers;
  }

  /**
   * @param {string} path
   * @param {RequestInit & {timeout?: number}} [init]
   */
  async #request(path, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeout ?? this.timeout);

    let response;
    try {
      response = await fetch(`${this.baseUrl}/${path.replace(/^\//, '')}`, {
        ...init,
        headers: this.#headers(init.headers),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);

      if (error.name === 'AbortError') {
        throw new SccBuilderApiError('timeout', t('A requisição excedeu o tempo limite.'), 0);
      }

      throw new SccBuilderApiError(
        'network_error',
        t(
          'Não foi possível conectar à API em ^1. Verifique se o servidor PHP está no ar.',
          this.baseUrl
        ),
        0
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new SccBuilderApiError(
        'invalid_response',
        t('A API respondeu com conteúdo não-JSON (HTTP ^1).', response.status),
        response.status,
        { body: text.slice(0, 500) }
      );
    }

    if (!response.ok || payload.status === 'error') {
      const error = payload.error ?? {};
      throw new SccBuilderApiError(
        error.code ?? 'http_error',
        error.message ?? `HTTP ${response.status}`,
        response.status,
        error.details ?? {}
      );
    }

    return payload.data ?? {};
  }

  /** Diagnóstico da instalação. */
  health() {
    return this.#request('health.php', { method: 'GET', timeout: 10_000 });
  }

  /**
   * Envia um arquivo para conversão.
   *
   * @param {File|Blob} file
   * @param {object} [options]
   * @param {string} [options.targetFormat]
   * @param {'none'|'balanced'|'aggressive'} [options.optimize]
   * @param {boolean} [options.flipAxis]
   * @param {number} [options.scale]
   * @param {'scc'|'none'} [options.preset] scc: meshopt, LODs e base para o validate-lot
   * @param {string} [options.modelId] reenvio do mesmo id vira v2, v3…
   * @param {string} [options.externalRef]
   * @param {boolean} [options.async]
   * @param {(percent: number) => void} [options.onProgress] progresso de UPLOAD
   */
  convert(file, options = {}) {
    const form = new FormData();
    form.append('file', file, file.name ?? 'model.glb');
    form.append('target_format', options.targetFormat ?? 'glb');
    form.append('optimize', options.optimize ?? 'balanced');
    form.append('flip_axis', options.flipAxis ? 'true' : 'false');
    form.append('scale', String(options.scale ?? 1));
    form.append('preset', options.preset ?? 'scc');
    if (options.modelId) form.append('model_id', options.modelId);
    if (options.externalRef) form.append('external_ref', options.externalRef);
    if (options.async) form.append('async', 'true');

    // XMLHttpRequest em vez de fetch: só ele reporta progresso de upload.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}/convert.php`);

      for (const [name, value] of Object.entries(this.#headers()))
        xhr.setRequestHeader(name, value);
      xhr.timeout = options.timeout ?? 600_000;

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          options.onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        let payload;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch {
          reject(
            new SccBuilderApiError('invalid_response', t('Resposta não-JSON da API.'), xhr.status)
          );

          return;
        }

        if (xhr.status >= 400 || payload.status === 'error') {
          const error = payload.error ?? {};
          reject(
            new SccBuilderApiError(
              error.code ?? 'http_error',
              error.message ?? `HTTP ${xhr.status}`,
              xhr.status,
              error.details ?? {}
            )
          );

          return;
        }

        resolve(payload.data ?? {});
      });

      xhr.addEventListener('error', () =>
        reject(new SccBuilderApiError('network_error', t('Falha de rede ao enviar o arquivo.'), 0))
      );
      xhr.addEventListener('timeout', () =>
        reject(new SccBuilderApiError('timeout', t('O upload excedeu o tempo limite.'), 0))
      );

      xhr.send(form);
    });
  }

  /** @param {string} jobId */
  getJob(jobId) {
    return this.#request(`jobs.php?job_id=${encodeURIComponent(jobId)}`);
  }

  /**
   * Acompanha um job até concluir ou falhar.
   *
   * @param {string} jobId
   * @param {{intervalMs?: number, timeoutMs?: number, onTick?: (job: object) => void}} [options]
   */
  async waitForJob(jobId, options = {}) {
    const interval = options.intervalMs ?? 2000;
    const deadline = Date.now() + (options.timeoutMs ?? 900_000);

    for (;;) {
      const { job } = await this.getJob(jobId);
      options.onTick?.(job);

      if (job.status === 'completed') return job;

      if (job.status === 'failed') {
        throw new SccBuilderApiError(
          job.error_code ?? 'conversion_failed',
          job.error_message ?? t('A conversão falhou.'),
          422,
          { job }
        );
      }

      if (Date.now() > deadline) {
        throw new SccBuilderApiError('timeout', t('Tempo de espera do job esgotado.'), 0, { job });
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /**
   * Confere um job convertido contra o lote (doc 13 §5.3).
   *
   * @param {string} jobId
   * @param {{id?: string, polygon: Array<[number, number]>, setback_m?: number, max_height_m?: number, far?: number}} lot
   * @param {{rotation_deg?: number, units?: string, position?: [number, number]}} [transform]
   */
  validateLot(jobId, lot, transform = {}) {
    return this.#request('validate-lot.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, lot, transform }),
    });
  }

  /** @param {{page?: number, perPage?: number}} [options] */
  listModels(options = {}) {
    const params = new URLSearchParams({
      action: 'list',
      page: String(options.page ?? 1),
      per_page: String(options.perPage ?? 20),
    });

    return this.#request(`models.php?${params}`);
  }

  /** @param {string} jobId */
  deleteModel(jobId) {
    return this.#request(`models.php?job_id=${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  }

  /**
   * Baixa o resultado como Blob (respeitando a API key).
   * @param {string} jobId
   */
  async download(jobId) {
    const response = await fetch(
      `${this.baseUrl}/download.php?job_id=${encodeURIComponent(jobId)}`,
      { headers: this.#headers() }
    );

    if (!response.ok) {
      throw new SccBuilderApiError('download_failed', `HTTP ${response.status}`, response.status);
    }

    return response.blob();
  }
}

/** Instância pronta para uso com a configuração de ambiente. */
export const apiClient = new SccBuilderClient({ token: readSessionToken() });
