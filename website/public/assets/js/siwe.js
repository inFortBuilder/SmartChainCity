/* Smart Chain City — entrar no jogo pelo site (trilha do site, passo 7).
 * SIWE (EIP-4361) com a carteira, o captcha de prova de trabalho do gateway e as chamadas à API do jogo.
 * Sem bibliotecas: a mensagem SIWE é montada aqui e o sha256 do captcha é o mesmo do mapa do jogo.
 * Expõe window.SCC.game. O token fica só nesta aba (sessionStorage) e vence com o JWT (1 h). */
(() => {
  'use strict';
  const api = (window.SCC && window.SCC.api) || {};
  const chain = (window.SCC && window.SCC.chain) || {};
  const KEY = 'scc.game.session';

  const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const W256 = new Uint32Array(64);
  
  /** sha256 de um texto ASCII (salt + número), em hexadecimal. */
  function sha256Ascii(text) {
    const n = text.length;
    const blocks = ((n + 8) >> 6) + 1;
    const words = new Uint32Array(blocks * 16);
    for (let i = 0; i < n; i++) words[i >> 2] |= (text.charCodeAt(i) & 0xff) << (24 - (i & 3) * 8);
    words[n >> 2] |= 0x80 << (24 - (n & 3) * 8);
    words[blocks * 16 - 1] = n * 8;
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const rotr = (x, r) => (x >>> r) | (x << (32 - r));
    for (let b = 0; b < blocks; b++) {
      for (let t = 0; t < 64; t++) {
        if (t < 16) W256[t] = words[b * 16 + t];
        else {
          const a = W256[t - 15], c = W256[t - 2];
          W256[t] = (W256[t - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W256[t - 7] + (rotr(c, 17) ^ rotr(c, 19) ^ (c >>> 10))) | 0;
        }
      }
      let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[t] + W256[t]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  const load = () => {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      return s && s.expiresAt > Date.now() ? s : null;
    } catch { return null; }
  };
  const save = (s) => { try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* sem armazenamento */ } };

  /** Chamada JSON à API do jogo. Erro com o código e a mensagem que o serviço devolveu. */
  async function call(base, path, { method = 'GET', body, token } = {}) {
    if (!base) throw Object.assign(new Error('api_off'), { code: 'api_off' });
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw Object.assign(new Error('offline'), { code: 'offline' }); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error?.message || 'Erro ' + res.status), { code: data?.error?.code || 'http_' + res.status, status: res.status });
    return data;
  }

  /** Acha o número do desafio (frações de segundo). undefined se o captcha está desligado. */
  async function solveCaptcha() {
    const c = await call(api.gateway, '/v1/auth/captcha');
    if (!c.enabled) return undefined;
    for (let n = 0; n <= c.maxnumber; n++) {
      if (sha256Ascii(c.salt + n) === c.challenge) {
        return btoa(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature }));
      }
      if (n % 5000 === 4999) await new Promise((r) => setTimeout(r));
    }
    throw Object.assign(new Error('captcha'), { code: 'captcha' });
  }

  /** Mensagem SIWE (EIP-4361), legível na carteira. */
  const siweMessage = ({ address, nonce }) => {
    const issued = new Date();
    const expires = new Date(issued.getTime() + 5 * 60_000);
    return [
      `${location.host} wants you to sign in with your Ethereum account:`,
      address,
      '',
      'Entrar na Smart Chain City.',
      '',
      `URI: ${location.origin}`,
      'Version: 1',
      `Chain ID: ${chain.chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issued.toISOString()}`,
      `Expiration Time: ${expires.toISOString()}`,
    ].join('\n');
  };

  /** Entra com a carteira conectada: assina a mensagem SIWE e troca pelo token do jogo. */
  async function signIn() {
    const w = window.SCC.wallet;
    if (!w.state.address) await w.connect();
    const address = w.state.address;
    const { nonce } = await call(api.gateway, '/v1/auth/siwe/nonce', { method: 'POST' });
    const message = siweMessage({ address, nonce });
    const hex = '0x' + Array.from(new TextEncoder().encode(message)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [hex, address] });
    const captcha = await solveCaptcha();
    const r = await call(api.gateway, '/v1/auth/siwe/verify', { method: 'POST', body: { message, signature, captcha } });
    const s = { token: r.access_token, address, expiresAt: Date.now() + r.expires_in * 1000 };
    save(s);
    return s;
  }

  /** O jogador: conta (gateway), primeiro avatar (game-core) e saldos do ledger (economy). */
  async function profile() {
    const s = load();
    if (!s) return null;
    const [me, avatars, balances] = await Promise.all([
      call(api.gateway, '/v1/me', { token: s.token }),
      call(api.game, '/v1/avatars', { token: s.token }).catch(() => ({ avatars: [] })),
      call(api.economy, '/v1/economy/balances', { token: s.token }).catch(() => ({ balances: [] })),
    ]);
    return { session: s, me, avatar: avatars.avatars?.[0] ?? null, balances: balances.balances ?? [] };
  }

  window.SCC = Object.assign(window.SCC || {}, {
    game: { signIn, signOut: () => save(null), session: load, profile },
  });
})();
