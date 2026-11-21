// Liga o mapa aos serviços (célula jogável, E1.6): o jogador entra com a
// carteira (SIWE, pelo gateway) ou com um código por e-mail, vê o avatar (game-core) e o THALER do ledger
// (economy), trabalha um turno e coleta. Aqui nada é simulado: quem decide é o
// servidor (ADR-0002). A gestão de lotes e negócios do painel "Meu
// patrimônio" continua simulada no navegador até o serviço world.

const params = new URLSearchParams(location.search);
const API = {
  gateway: params.get('gateway') ?? 'http://127.0.0.1:8000',
  economy: params.get('economy') ?? 'http://127.0.0.1:8010',
  game: params.get('game') ?? 'http://127.0.0.1:8020',
  world: params.get('world') ?? 'http://127.0.0.1:8030',
};
const CITY = 'pittsburg';
// Lotes do jogador no servidor ficam violeta; os da gestão simulada, ciano.
const SERVER_LOT_COLOR = 0x8b5cf6;
const TOKEN_KEY = 'scc-servidor-token';
const DEV_WALLET_KEY = 'scc-carteira-de-teste';
// A carteira de teste guarda a chave no navegador: só serve em máquina local.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const VIEM = 'https://esm.sh/viem@2.21.54';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const storage = {
  get: (k, store = sessionStorage) => {
    try {
      return store.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v, store = sessionStorage) => {
    try {
      if (v === null) store.removeItem(k);
      else store.setItem(k, v);
    } catch {
      // modo privado: segue sem guardar
    }
  },
};

/** wei (18 casas) → SCITY com 2 casas, para a tela. */
const scity = (wei) =>
  (Number(BigInt(wei) / 10n ** 14n) / 10_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thaler = (cents) => (Number(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const left = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'concluindo…';
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

/** Texto digitado ("12,5" ou "12.5") → unidade mínima (centavos ou wei), sem float. */
function toUnits(text, decimals) {
  const t = String(text).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [int, frac = ''] = t.split('.');
  if (frac.length > decimals) return null;
  return BigInt(int) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Id do aparelho para o antifraude do game-core (E2.9): aleatório, guardado neste
// navegador. Não identifica a pessoa; só junta as contas que jogam no mesmo aparelho.
const DEVICE_KEY = 'scc-aparelho';
function deviceId() {
  let id = storage.get(DEVICE_KEY, localStorage);
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    id = crypto.randomUUID().replace(/-/g, '');
    storage.set(DEVICE_KEY, id, localStorage);
  }
  return id;
}

async function call(base, path, { method = 'GET', body, token, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(base === API.game ? { 'x-device-id': deviceId() } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', `Sem resposta de ${base}.`);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, json.error?.code ?? 'erro', json.error?.message ?? `Erro ${response.status}.`);
  return json;
}

// --- Captcha de prova de trabalho (formato ALTCHA) ---------------------------
// SHA-256 em JavaScript puro: o crypto.subtle só existe em HTTPS ou localhost,
// e o teste no celular pela rede local (scc-telas-rede) é HTTP.
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

/**
 * Pede o desafio ao gateway e acha o número (frações de segundo). Devolve a
 * solução em base64 para mandar no login, ou undefined se o captcha está desligado.
 */
async function solveCaptcha() {
  const c = await call(API.gateway, '/v1/auth/captcha');
  if (!c.enabled) return undefined;
  for (let n = 0; n <= c.maxnumber; n++) {
    if (sha256Ascii(c.salt + n) === c.challenge) {
      return btoa(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature }));
    }
    // Devolve a vez à tela a cada 5 mil tentativas, para ela não travar no celular.
    if (n % 5000 === 4999) await new Promise((r) => setTimeout(r));
  }
  throw new ApiError(0, 'captcha', 'Não deu para resolver o captcha. Tente de novo.');
}

/**
 * Assina a mensagem SIWE com a MetaMask, ou com a carteira de teste guardada no
 * navegador. Serve para entrar e para ligar a carteira a uma conta de e-mail.
 */
async function siweProof(useTestWallet, statement) {
  const { createSiweMessage } = await import(`${VIEM}/siwe`);
  let address;
  let sign;
  if (useTestWallet) {
    const { generatePrivateKey, privateKeyToAccount } = await import(`${VIEM}/accounts`);
    let key = storage.get(DEV_WALLET_KEY, localStorage);
    if (!key) {
      key = generatePrivateKey();
      storage.set(DEV_WALLET_KEY, key, localStorage);
    }
    const account = privateKeyToAccount(key);
    address = account.address;
    sign = (message) => account.signMessage({ message });
  } else {
    [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const { getAddress } = await import(VIEM);
    address = getAddress(address);
    sign = (message) => window.ethereum.request({ method: 'personal_sign', params: [message, address] });
  }

  const { nonce } = await call(API.gateway, '/v1/auth/siwe/nonce', { method: 'POST' });
  const message = createSiweMessage({
    address,
    chainId: 97,
    domain: location.host,
    nonce,
    uri: location.origin,
    version: '1',
    statement,
  });
  return { message, signature: await sign(message), address };
}

async function signIn(useTestWallet) {
  const { message, signature, address } = await siweProof(useTestWallet, 'Entrar na Smart Chain City.');
  const captcha = await solveCaptcha();
  const result = await call(API.gateway, '/v1/auth/siwe/verify', { method: 'POST', body: { message, signature, captcha } });
  return { token: result.access_token, address, email: result.account.email, expiresAt: Date.now() + result.expires_in * 1000 };
}

/** Login por e-mail: o gateway manda um código de 6 dígitos (no MVP local, no log dele). */
async function sendEmailCode(email) {
  const captcha = await solveCaptcha();
  await call(API.gateway, '/v1/auth/email/start', { method: 'POST', body: { email, captcha } });
}

async function verifyEmailCode(email, code) {
  try {
    const result = await call(API.gateway, '/v1/auth/email/verify', { method: 'POST', body: { email, code } });
    return { token: result.access_token, address: null, email: result.account.email, expiresAt: Date.now() + result.expires_in * 1000 };
  } catch (error) {
    return codeError(error);
  }
}

/** Código errado é 401, mas não é sessão expirada: mostra a mensagem e deixa tentar de novo. */
function codeError(error) {
  if (error.status === 401 && error.code === 'invalid_code') throw new ApiError(400, error.code, error.message);
  throw error;
}

/** Códigos de 401 que querem dizer "token não vale mais". */
const SESSION_ERRORS = new Set(['missing_credentials', 'invalid_token', 'token_expired']);

/** Vínculos da conta logada: carteira na conta de e-mail, e-mail na conta de carteira. */
async function linkWallet(token, useTestWallet) {
  const { message, signature } = await siweProof(useTestWallet, 'Ligar esta carteira à minha conta na Smart Chain City.');
  try {
    return await call(API.gateway, '/v1/me/wallets', { method: 'POST', token, body: { message, signature } });
  } catch (error) {
    // Assinatura ou nonce recusados também são 401, mas a sessão continua valendo.
    if (error.status === 401 && !SESSION_ERRORS.has(error.code)) throw new ApiError(400, error.code, error.message);
    throw error;
  }
}

async function linkEmailVerify(token, email, code) {
  try {
    return await call(API.gateway, '/v1/me/email/verify', { method: 'POST', token, body: { email, code } });
  } catch (error) {
    return codeError(error);
  }
}

export function createServidor(map) {
  const panel = document.createElement('aside');
  panel.className = 'servidor glass';
  panel.setAttribute('aria-label', 'Jogo no servidor');
  document.body.append(panel);

  let session = null;
  try {
    session = JSON.parse(storage.get(TOKEN_KEY));
    if (!session || session.expiresAt < Date.now()) session = null;
  } catch {
    session = null;
  }
  let data = { avatar: null, balance: '0', scity: '0', lots: [], shifts: [], fx: null, withdrawals: null, kyc: null, invitations: [] };
  /** Alimentos do mercado do jogo, com o preço de uma unidade em centavos de THALER. */
  let foods = [];
  let message = '';
  let messageOk = false;
  let busy = false;
  let open = true;
  /** E-mail que já recebeu o código: a tela pede o código em vez do e-mail. */
  let emailSent = null;
  /** O mesmo, para pôr e-mail na conta logada. */
  let linkSent = null;
  /** Conta no gateway: e-mail e carteiras ligadas (null até o primeiro /v1/me). */
  let me = null;

  const logout = (why = '') => {
    session = null;
    me = null;
    linkSent = null;
    storage.set(TOKEN_KEY, null);
    data = { avatar: null, balance: '0', scity: '0', lots: [], shifts: [], fx: null, withdrawals: null, kyc: null, invitations: [] };
    drawLots();
    message = why;
    render();
  };

  async function refresh() {
    if (!session) return render();
    try {
      const [avatars, balances, profile] = await Promise.all([
        call(API.game, '/v1/avatars', { token: session.token }),
        call(API.economy, '/v1/economy/balances', { token: session.token }),
        // Gateway fora não derruba o painel: só some a parte de vínculos.
        call(API.gateway, '/v1/me', { token: session.token }).catch((error) => {
          if (error.status === 401) throw error;
          return null;
        }),
      ]);
      if (profile) me = { email: profile.account.email, wallets: profile.wallets.map((w) => w.address) };
      data.avatar = avatars.avatars[0] ?? null;
      // Lista do mercado: pública, busca uma vez (se o game-core for antigo, só não aparece).
      if (!foods.length) {
        foods = await call(API.game, '/v1/catalog/foods')
          .then((r) => r.foods)
          .catch(() => []);
      }
      data.balance = balances.balances.find((b) => b.currency === 'THALER')?.amount ?? '0';
      data.scity = balances.balances.find((b) => b.currency === 'SCITY')?.amount ?? '0';
      // Lotes do servidor: se o world estiver fora, o resto do painel segue.
      data.lots = await call(API.world, '/v1/world/me/lots', { token: session.token })
        .then((r) => r.lots)
        .catch(() => data.lots);
      drawLots();
      // Imóveis onde fui convidado (visita pelo street view).
      data.invitations = await call(API.world, '/v1/world/me/invitations', { token: session.token })
        .then((r) => r.invitations)
        .catch(() => data.invitations);
      // Câmbio e saque (economy): se estiverem desligados (503), a seção some.
      [data.fx, data.withdrawals, data.kyc] = await Promise.all([
        call(API.economy, '/v1/economy/fx').catch(() => null),
        call(API.economy, '/v1/economy/withdrawals', { token: session.token }).catch((error) => {
          if (error.status === 401) throw error;
          return null;
        }),
        // KYC no gateway: nível da conta e o último pedido de verificação.
        call(API.gateway, '/v1/me/kyc', { token: session.token }).catch(() => null),
      ]);
      data.shifts = data.avatar
        ? (await call(API.game, `/v1/avatars/${data.avatar.id}/shifts`, { token: session.token })).shifts
        : [];
    } catch (error) {
      if (error.status === 401) return logout('Sessão expirou. Entre de novo.');
      message = error.code === 'offline' ? 'Serviços fora do ar. Veja como subir no README.' : error.message;
    }
    render();
  }

  async function act(fn) {
    if (busy) return;
    busy = true;
    message = '';
    messageOk = false;
    render();
    try {
      await fn();
    } catch (error) {
      if (error.status === 401) return logout('Sessão expirou. Entre de novo.');
      message = error.code === 'offline' ? 'Serviços fora do ar. Veja como subir no README.' : error.message;
    } finally {
      busy = false;
    }
    await refresh();
  }

  const sign = (n) => (n > 0 ? `+${n}` : String(n));

  // Lista das tarefas do turno: feita, em andamento e próxima, pelo relógio do navegador.
  const minigameList = (m) => {
    const now = Date.now();
    const items = m.tasks
      .map((t) => {
        const s = new Date(t.starts_at).getTime();
        const e = new Date(t.ends_at).getTime();
        const state = now >= e ? 'feita' : now >= s ? 'agora' : 'depois';
        const fx = [t.energy && `${t.energy === '+' ? '+' : '−'}energia`, t.happiness && `${t.happiness === '+' ? '+' : '−'}felicidade`].filter(Boolean).join(' · ');
        const mark = state === 'feita' ? '✓' : state === 'agora' ? '▶' : '·';
        return `<li class="tarefa tarefa--${state}"><span>${mark} ${esc(t.name)}</span>${fx ? `<span class="muted">${fx}</span>` : ''}</li>`;
      })
      .join('');
    return `<ol class="minigame" aria-label="Tarefas do turno">${items}</ol>`;
  };

  /**
   * Câmbio THALER ↔ SCITY e saque pelo GameVault (passo 11 e E3.7). Quem decide
   * cotação, spread, teto e freio é o economy; aqui só mostra e pede.
   */
  const bankSection = (wallets) => {
    const fx = data.fx;
    if (!fx) return '';
    const brake = fx.pool_brake > 0 ? ` · <strong>freio do pool ${Math.round(fx.pool_brake * 100)}%</strong>` : '';
    let html = `<h3>💱 Câmbio</h3>
      <p class="muted pequeno">1 SCITY = ${fx.thaler_per_scity.toLocaleString('pt-BR')} THALER (US$ ${fx.scity_usd.toLocaleString('pt-BR')}${fx.provisional ? ', cotação provisória' : ''}).
      Para SCITY: ${(fx.exit_spread_bps / 100).toLocaleString('pt-BR')}% de spread, mínimo de ${thaler(fx.min_exit_cents)} e até ${thaler(fx.daily_exit_cents)} THALER por dia${brake}.</p>
      <form data-form="cambio" class="banco">
        <input class="campo" name="valor" inputmode="decimal" required placeholder="Valor (ex.: 12,5)" aria-label="Valor a converter" />
        <div class="linha">
        <button class="btn btn--ghost pequeno" type="submit" name="dir" value="scity_to_thaler" ${busy ? 'disabled' : ''}>SCITY → THALER</button>
        <button class="btn btn--ghost pequeno" type="submit" name="dir" value="thaler_to_scity" ${busy ? 'disabled' : ''}>THALER → SCITY</button></div>
      </form>`;
    if (data.withdrawals === null) return html;
    html += '<h3>🏦 Saque para a carteira</h3>';
    if (!wallets.length) return `${html}<p class="muted pequeno">Ligue uma carteira à conta para sacar SCITY.</p>`;
    html += `<form data-form="saque" class="banco">
        <input class="campo" name="valor" inputmode="decimal" required placeholder="SCITY a sacar" aria-label="SCITY a sacar" />
        <button class="btn btn--blue pequeno" type="submit" ${busy ? 'disabled' : ''}>Sacar para ${short(wallets[0])}</button>
      </form>
      <p class="muted pequeno">O SCITY sai do jogo agora; a carteira resgata no GameVault em até 48 h, ou ele volta.</p>`;
    // KYC: sem verificação, até 300 SCITY em 30 dias (premissa do economy).
    if (data.kyc) {
      const pending = data.kyc.request?.status === 'pending';
      const rejected = data.kyc.request?.status === 'rejected';
      if (data.kyc.level >= 1) {
        html += '<p class="muted pequeno">🪪 Identidade verificada: só o teto de 1.000 SCITY em 24 h vale.</p>';
      } else if (pending) {
        html += '<p class="muted pequeno">🪪 Verificação de identidade em análise. Até lá, o saque vai até 300 SCITY em 30 dias.</p>';
      } else {
        html += `<p class="muted pequeno">🪪 Sem verificação de identidade, o saque vai até 300 SCITY em 30 dias.${rejected ? ' A última verificação foi recusada.' : ''}</p>
          <button class="btn btn--ghost pequeno" type="button" data-s="kyc" ${busy ? 'disabled' : ''}>Verificar identidade</button>`;
      }
    }
    const list = data.withdrawals.withdrawals.slice(0, 5);
    if (list.length) {
      const label = { pending: 'pronto para resgatar', claimed: 'resgatado', refunded: 'venceu, voltou ao jogo', failed: 'falhou', created: 'processando' };
      html += `<ul class="lista-saques">${list
        .map(
          (w) => `<li><span>${scity(w.amount_wei)} SCITY · ${esc(label[w.status] ?? w.status)}${w.status === 'pending' ? ` · vence em ${left(w.deadline)}` : ''}</span>
            ${w.voucher && window.ethereum ? `<button class="btn btn--primary pequeno" type="button" data-s="resgatar" data-w="${esc(w.id)}" ${busy ? 'disabled' : ''}>Resgatar</button>` : ''}</li>`,
        )
        .join('')}</ul>`;
      if (list.some((w) => w.voucher) && !window.ethereum) {
        html += '<p class="muted pequeno">Para resgatar, abra o mapa num navegador com a MetaMask.</p>';
      }
    }
    return html;
  };

  /** Resgate do voucher: a carteira do jogador chama GameVault.claim (ela paga o gás). */
  async function claimVoucher(w) {
    const { createWalletClient, custom, parseAbi } = await import(VIEM);
    const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const chainId = Number(await window.ethereum.request({ method: 'eth_chainId' }));
    if (chainId !== data.withdrawals.chain_id) {
      throw new ApiError(400, 'wrong_chain', `A carteira está na rede ${chainId}; o cofre está na ${data.withdrawals.chain_id}.`);
    }
    const client = createWalletClient({ account, transport: custom(window.ethereum) });
    const v = w.voucher;
    return client.writeContract({
      address: data.withdrawals.contract,
      abi: parseAbi(['function claim((address to,uint256 amount,uint256 nonce,uint256 deadline) w, bytes sig)']),
      functionName: 'claim',
      args: [{ to: v.to, amount: BigInt(v.amount), nonce: BigInt(v.nonce), deadline: BigInt(v.deadline) }, v.signature],
      chain: null,
    });
  }

  const bar = (label, value, max = 10) =>
    `<div class="attr"><span>${label}</span><div class="barra"><span style="width:${(value / max) * 100}%"></span></div><b>${value}</b></div>`;

  function render() {
    if (!open) {
      panel.innerHTML = '<button class="btn btn--ghost" type="button" data-s="abrir">🎮 Jogo no servidor</button>';
      return;
    }
    const head = `<div class="linha cab"><h2>🎮 Jogo no servidor</h2><button class="btn btn--ghost" type="button" data-s="fechar" aria-label="Recolher">–</button></div>`;
    const note = message ? `<p class="${messageOk ? 'ok-s' : 'aviso-s'}">${esc(message)}</p>` : '';
    if (!session) {
      panel.innerHTML = `${head}
        <p class="muted">Entre com a carteira ou com o e-mail para trabalhar e receber THALER de verdade, pelo servidor.</p>
        ${window.ethereum ? '<button class="btn btn--primary" type="button" data-s="entrar">Entrar com a carteira</button>' : ''}
        ${LOCAL ? '<button class="btn btn--blue" type="button" data-s="entrar-teste">Entrar com carteira de teste</button>' : ''}
        ${!window.ethereum && !LOCAL ? '<p class="muted">Instale uma carteira (MetaMask) ou entre com o e-mail.</p>' : ''}
        <h3>Com e-mail</h3>
        ${
          emailSent
            ? `<form data-form="codigo">
                <p class="muted">Código enviado para <b>${esc(emailSent)}</b>. Vale 10 minutos.${LOCAL ? ' Na máquina local, ele aparece no log do gateway.' : ''}</p>
                <div class="linha"><input class="campo" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000" aria-label="Código de 6 dígitos" /></div>
                <button class="btn btn--primary" type="submit" ${busy ? 'disabled' : ''}>Entrar</button>
                <button class="btn btn--ghost pequeno" type="button" data-s="email-voltar">Trocar e-mail ou pedir outro código</button>
              </form>`
            : `<form data-form="email">
                <div class="linha"><input class="campo" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="voce@exemplo.com" aria-label="E-mail" /></div>
                <button class="btn btn--blue" type="submit" ${busy ? 'disabled' : ''}>Receber código</button>
              </form>`
        }
        ${note}`;
      return;
    }

    const a = data.avatar;
    const running = data.shifts.find((s) => s.status === 'running');
    const done = data.shifts.filter((s) => s.status === 'done');
    const last = data.shifts.find((s) => s.status !== 'running');
    let body = '';
    if (!a) {
      body = `<p class="muted">Sua conta ainda não tem avatar. Na versão final ele vem da Lucky Box.</p>
        <button class="btn btn--blue" type="button" data-s="avatar" ${busy ? 'disabled' : ''}>Pegar avatar de teste</button>`;
    } else {
      const at = a.attributes;
      body = `<p><strong>${esc(a.job.label)}</strong> <span class="muted">· ${esc(a.rarity)}</span></p>
        ${bar('Energia', at.energy)}${bar('Saúde', at.health)}${bar('Felicidade', at.happiness)}${bar('Alimentação', at.food)}${bar('Higiene', at.hygiene)}
        <p class="muted pequeno">Educação ${at.education}/100${a.status.earnsReward ? '' : ' · <strong>sem comer há 48 h: o turno não paga</strong>'}</p>`;
      // Hospital compulsório (E2.3): saúde ou energia em 0 interna por 1 dia, com taxa de 30 THALER.
      const internado = a.status.inHospital;
      if (internado) {
        body += `<h3>🏥 Internado</h3>
          <p class="muted pequeno">Energia ou saúde chegou a 0. Alta em ${left(a.hospital_until)}, com energia e saúde cheias.
          Taxa de 30 THALER (perdoada se faltar saldo). Até lá, sem trabalho e sem mercado.</p>`;
      }
      // Doenças e farmácia do jogo (E2.3): o remédio custa 10 THALER e cura com 70% de chance.
      if (!internado && a.conditions?.length) {
        body += `<h3>🤒 Doente</h3>${a.conditions
          .map(
            (c) => `<div class="linha"><p class="muted pequeno">${esc(c.label)}${c.blocks_work ? ' · de cama, sem trabalhar' : ` · rendimento ×${c.yield_factor}`}${c.hospital_only ? ' · <strong>−1 saúde a cada 15 min</strong>' : ''} · passa em ${left(c.ends_at)}</p>
            ${
              c.hospital_only
                ? `<button class="btn btn--blue pequeno" type="button" data-s="tratar" ${busy ? 'disabled' : ''}>Hospital · 30</button>`
                : `<button class="btn btn--blue pequeno" type="button" data-s="remedio" data-c="${esc(c.code)}" ${busy ? 'disabled' : ''}>Remédio · 10</button>`
            }</div>`,
          )
          .join('')}<p class="muted pequeno">O remédio cura com 70% de chance; sem cura, o THALER não volta.${
          a.conditions.some((c) => c.hospital_only) ? ' Febre, enxaqueca e virose só o hospital trata: 4 h internado, sai curado e com a saúde cheia.' : ''
        }</p>`;
      }
      // Mercado do jogo (E2.3): comer custa THALER e sobe a alimentação.
      // Despensa: pacotes comprados antes; comer daqui não cobra de novo.
      const guardados = a.pantry ?? [];
      if (!internado && guardados.length) {
        body += `<h3>🧺 Despensa</h3><div class="linha">${guardados
          .map((p) => {
            const f = foods.find((x) => x.code === p.food);
            return `<button class="btn btn--ghost pequeno" type="button" data-s="consumir" data-f="${esc(p.food)}" ${busy || at.food >= 10 ? 'disabled' : ''}>${esc(f?.label ?? p.food)} × ${p.units}</button>`;
          })
          .join('')}</div>${at.food >= 10 ? '<p class="muted pequeno">Satisfeito: come da despensa quando a alimentação baixar.</p>' : ''}`;
      }
      if (!internado && foods.length) {
        const options = foods
          .map((f) => `<option value="${esc(f.code)}">${esc(f.label)} · ${thaler(f.price)} (pacote de ${f.pack}: ${thaler(f.pack_price)}) · ${sign(f.energy)} energia, ${sign(f.health)} saúde</option>`)
          .join('');
        body += `<form data-form="comer" class="comer">
          <div class="linha"><select class="campo" name="food" aria-label="Alimento">${options}</select>
          <button class="btn btn--blue" type="submit" name="acao" value="comer" ${busy || at.food >= 10 ? 'disabled' : ''}>Comer</button>
          <button class="btn btn--ghost" type="submit" name="acao" value="pacote" ${busy ? 'disabled' : ''}>Pacote</button></div>
          <p class="muted pequeno">Cada refeição dá +3 de alimentação; o pacote vai para a despensa.${foods.some((f) => f.provisional_price) ? ' Preço provisório até o game designer definir.' : ''}</p>
        </form>`;
      }
      if (running) {
        const total = new Date(running.ends_at) - new Date(running.starts_at);
        const pct = Math.min(100, ((Date.now() - new Date(running.starts_at)) / total) * 100);
        body += `<h3>Trabalhando · turno de ${running.hours} h</h3>
          <div class="barra"><span style="width:${pct}%"></span></div>
          <p class="muted pequeno">Falta ${left(running.ends_at)}. Pode fechar o jogo: o servidor conclui o turno.<br>
          Compromisso do sorteio: <code>${running.seed_commit.slice(0, 16)}…</code></p>`;
        // Minigame (E2.2): as tarefas da profissão ao longo do turno, calculadas pelo relógio daqui.
        if (running.minigame) body += minigameList(running.minigame);
      } else if (!internado) {
        body += `<div class="linha">
          <button class="btn btn--blue" type="button" data-s="work" data-h="6" ${busy || !a.status.canWork ? 'disabled' : ''}>Trabalhar 6 h</button>
          <button class="btn btn--blue" type="button" data-s="work" data-h="12" ${busy || !a.status.canWork ? 'disabled' : ''}>Trabalhar 12 h</button></div>`;
      }
      if (done.length) {
        const total = done.reduce((sum, s) => sum + BigInt(s.result.thaler), 0n);
        body += `<button class="btn btn--primary" type="button" data-s="claim" ${busy ? 'disabled' : ''}>Coletar ${thaler(total)} THALER</button>`;
      }
      if (last?.result) {
        body += `<p class="muted pequeno">Último turno: ${thaler(last.result.thaler)} THALER${last.result.damaged ? ' (com danos)' : ''}${last.minigame?.damage ? ` — ${esc(last.minigame.damage.event)} em “${esc(last.minigame.damage.task)}”` : ''} · semente revelada <code>${last.seed.slice(0, 12)}…</code></p>`;
      }
    }
    const email = me?.email ?? session.email ?? null;
    const wallets = me?.wallets ?? (session.address ? [session.address] : []);
    const who = [email ? esc(email) : '', ...wallets.map(short)].filter(Boolean).join('<br>');
    // Vínculos: a conta de e-mail ganha carteira; a de carteira ganha e-mail.
    let links = '';
    if (me && !wallets.length && (window.ethereum || LOCAL)) {
      links += `<p class="muted pequeno">Ligue uma carteira para entrar também por ela e, depois, receber NFTs.</p>
        <div class="linha">
          ${window.ethereum ? `<button class="btn btn--ghost pequeno" type="button" data-s="ligar-carteira" ${busy ? 'disabled' : ''}>Ligar carteira</button>` : ''}
          ${LOCAL ? `<button class="btn btn--ghost pequeno" type="button" data-s="ligar-carteira-teste" ${busy ? 'disabled' : ''}>Ligar carteira de teste</button>` : ''}
        </div>`;
    }
    if (me && !email) {
      links += linkSent
        ? `<form data-form="ligar-codigo">
            <p class="muted pequeno">Código enviado para <b>${esc(linkSent)}</b>.${LOCAL ? ' Na máquina local, ele aparece no log do gateway.' : ''}</p>
            <div class="linha"><input class="campo" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000" aria-label="Código de 6 dígitos" />
            <button class="btn btn--ghost pequeno" type="submit" ${busy ? 'disabled' : ''}>Confirmar</button></div>
            <button class="btn btn--ghost pequeno" type="button" data-s="ligar-email-voltar">Trocar e-mail</button>
          </form>`
        : `<form data-form="ligar-email">
            <p class="muted pequeno">Ponha um e-mail na conta para entrar sem a carteira.</p>
            <div class="linha"><input class="campo" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="voce@exemplo.com" aria-label="E-mail da conta" />
            <button class="btn btn--ghost pequeno" type="submit" ${busy ? 'disabled' : ''}>Receber código</button></div>
          </form>`;
    }
    panel.innerHTML = `${head}
      <dl class="resumo"><dt>Conta</dt><dd>${who}</dd><dt>THALER (ledger)</dt><dd>${thaler(data.balance)}</dd><dt>SCITY (ledger)</dt><dd>${scity(data.scity)}</dd><dt>Lotes no servidor</dt><dd>${data.lots.length}</dd></dl>
      ${data.lots.length ? `<p class="muted pequeno">${data.lots.map((l) => esc(l.code)).join(' · ')} <span class="tag-srv">violeta no mapa</span></p>` : '<p class="muted pequeno">Clique num lote verde e compre pela ficha.</p>'}
      ${data.invitations.length ? `<h3>🚪 Convites</h3><ul class="lista">${data.invitations
        .map((v) => `<li><span>${esc(v.place.label)} · lote ${v.place.lot_id}</span> <button class="btn btn--ghost pequeno" type="button" data-s="visitar" data-lote="${v.place.lot_id}">Ir até lá</button></li>`)
        .join('')}</ul>` : ''}
      ${LOCAL ? `<button class="btn btn--ghost pequeno" type="button" data-s="faucet" ${busy ? 'disabled' : ''}>+1.000 SCITY de teste</button>` : ''}
      ${links}
      ${bankSection(wallets)}
      ${body}${note}
      <button class="btn btn--ghost pequeno" type="button" data-s="sair">Sair</button>`;
  }

  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target.closest('form[data-form]');
    if (!form || busy) return;
    const field = new FormData(form);
    if (form.dataset.form === 'comer') {
      const food = String(field.get('food') ?? '');
      const item = foods.find((f) => f.code === food);
      if (e.submitter?.value === 'pacote') {
        return act(async () => {
          const r = await call(API.game, `/v1/avatars/${data.avatar.id}/pantry`, {
            method: 'POST',
            token: session.token,
            body: { food },
            headers: { 'idempotency-key': crypto.randomUUID() },
          });
          const guardado = r.avatar.pantry.find((p) => p.food === food)?.units ?? 0;
          message = `Pacote de ${item?.label ?? food}: −${thaler(r.purchase.price)} THALER, ${guardado} na despensa.`;
          messageOk = true;
        });
      }
      return act(async () => {
        // A chave faz o servidor reconhecer um clique repetido como o mesmo pedido.
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/meals`, {
          method: 'POST',
          token: session.token,
          body: { food },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        const ill = r.avatar.conditions?.find((c) => c.code === r.meal.effects.condition);
        message = `${item?.label ?? food}: −${thaler(r.meal.price)} THALER, alimentação ${r.avatar.attributes.food}/10.${ill ? ` Deu ${ill.label.toLowerCase()}.` : ''}`;
        messageOk = true;
      });
    }
    if (form.dataset.form === 'cambio') {
      const direction = e.submitter?.value === 'thaler_to_scity' ? 'thaler_to_scity' : 'scity_to_thaler';
      const amount = toUnits(field.get('valor'), direction === 'thaler_to_scity' ? 2 : 18);
      if (!amount) {
        message = 'Valor inválido: use números, com vírgula para as casas.';
        return render();
      }
      return act(async () => {
        const r = await call(API.economy, '/v1/economy/exchange', {
          method: 'POST',
          token: session.token,
          body: { direction, amount: amount.toString() },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        const c = r.conversion;
        message =
          direction === 'scity_to_thaler'
            ? `${scity(c.scity_wei)} SCITY viraram ${thaler(c.thaler_cents)} THALER.`
            : `${thaler(c.thaler_cents)} THALER viraram ${scity(c.scity_wei)} SCITY (spread de ${thaler(c.fee_cents)} queimado).`;
        messageOk = true;
      });
    }
    if (form.dataset.form === 'saque') {
      const amount = toUnits(field.get('valor'), 18);
      const wallet = (me?.wallets ?? [])[0] ?? session.address;
      if (!amount || !wallet) {
        message = 'Valor inválido.';
        return render();
      }
      return act(async () => {
        const r = await call(API.economy, '/v1/economy/withdrawals', {
          method: 'POST',
          token: session.token,
          body: { wallet, amount_wei: amount.toString() },
        });
        message = `Saque de ${scity(r.withdrawal.amount_wei)} SCITY pronto. ${window.ethereum ? 'Clique em Resgatar.' : 'Resgate com a carteira.'}`;
        messageOk = true;
      });
    }
    if (form.dataset.form === 'email') {
      const email = String(field.get('email') ?? '').trim();
      return act(async () => {
        await sendEmailCode(email);
        emailSent = email;
      });
    }
    if (form.dataset.form === 'ligar-email') {
      const email = String(field.get('email') ?? '').trim();
      return act(async () => {
        await call(API.gateway, '/v1/me/email/start', { method: 'POST', token: session.token, body: { email } });
        linkSent = email;
      });
    }
    const code = String(field.get('code') ?? '').trim();
    if (form.dataset.form === 'ligar-codigo') {
      return act(async () => {
        try {
          await linkEmailVerify(session.token, linkSent, code);
        } catch (error) {
          // E-mail de outra conta: não adianta outro código, volta para o campo do e-mail.
          if (error.status === 409) linkSent = null;
          throw error;
        }
        message = `E-mail ${linkSent} ligado à conta.`;
        messageOk = true;
        linkSent = null;
      });
    }
    return act(async () => {
      session = await verifyEmailCode(emailSent, code);
      storage.set(TOKEN_KEY, JSON.stringify(session));
      emailSent = null;
    });
  });

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled) return;
    const what = b.dataset.s;
    if (what === 'fechar' || what === 'abrir') {
      open = what === 'abrir';
      return render();
    }
    if (what === 'sair') return logout();
    if (what === 'visitar') return map.walkTo?.(Number(b.dataset.lote));
    if (what === 'ligar-carteira' || what === 'ligar-carteira-teste') {
      return act(async () => {
        await linkWallet(session.token, what === 'ligar-carteira-teste');
        message = 'Carteira ligada à conta. Agora dá para entrar por ela também.';
        messageOk = true;
      });
    }
    if (what === 'ligar-email-voltar') {
      linkSent = null;
      message = '';
      return render();
    }
    if (what === 'email-voltar') {
      emailSent = null;
      message = '';
      return render();
    }
    if (what === 'entrar' || what === 'entrar-teste') {
      return act(async () => {
        session = await signIn(what === 'entrar-teste');
        storage.set(TOKEN_KEY, JSON.stringify(session));
      });
    }
    if (what === 'resgatar') {
      const w = data.withdrawals?.withdrawals.find((x) => x.id === b.dataset.w);
      if (!w?.voucher) return;
      return act(async () => {
        const hash = await claimVoucher(w);
        message = `Resgate enviado (${short(hash)}). O jogo marca como resgatado em até 1 min.`;
        messageOk = true;
      });
    }
    if (what === 'kyc') {
      return act(async () => {
        await call(API.gateway, '/v1/me/kyc', { method: 'POST', token: session.token });
        message = 'Pedido de verificação enviado. No MVP local, a aprovação é pela rota interna do gateway (veja o README).';
        messageOk = true;
      });
    }
    if (what === 'faucet') {
      return act(async () => {
        await call(API.economy, '/v1/dev/faucet', { method: 'POST', token: session.token });
        message = '+1.000 SCITY de teste no ledger.';
        messageOk = true;
      });
    }
    if (what === 'avatar') return act(() => call(API.game, '/v1/dev/avatar', { method: 'POST', token: session.token }));
    if (what === 'work') {
      return act(() =>
        call(API.game, `/v1/avatars/${data.avatar.id}/work`, { method: 'POST', token: session.token, body: { shift: Number(b.dataset.h) } }),
      );
    }
    if (what === 'consumir') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/consume`, {
          method: 'POST',
          token: session.token,
          body: { food: b.dataset.f },
        });
        const label = foods.find((f) => f.code === b.dataset.f)?.label ?? b.dataset.f;
        message = `${label} da despensa: alimentação ${r.avatar.attributes.food}/10.`;
        messageOk = true;
      });
    }
    if (what === 'remedio') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/medicine`, {
          method: 'POST',
          token: session.token,
          body: { condition: b.dataset.c },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        message = r.cured ? `Remédio: −${thaler(r.medicine.price)} THALER, curado.` : `Remédio: −${thaler(r.medicine.price)} THALER, mas não curou. Pode tentar de novo.`;
        messageOk = r.cured;
      });
    }
    if (what === 'tratar') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/hospital/treat`, { method: 'POST', token: session.token });
        message = `Hospital: tratamento de 30 THALER, alta em ${left(r.stay.discharge_at)}.`;
        messageOk = true;
      });
    }
    if (what === 'claim') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/claim`, { method: 'POST', token: session.token });
        message = `+${thaler(r.thaler)} THALER coletados no ledger.`;
        messageOk = true;
      });
    }
  });

  const group = new map.THREE.Group();
  map.scene.add(group);
  async function drawLots() {
    group.children.splice(0).forEach((m) => m.geometry.dispose());
    if (!data.lots.length) return;
    await map.loadLotsFor(data.lots.map((l) => l.id));
    for (const l of data.lots) {
      const ring = map.lotRing(l.id);
      const shape = new map.THREE.Shape(ring.map(([x, z]) => new map.THREE.Vector2(x, -z)));
      const mesh = new map.THREE.Mesh(
        new map.THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
        new map.THREE.MeshBasicMaterial({ color: SERVER_LOT_COLOR, transparent: true, opacity: 0.85, depthWrite: false }),
      );
      mesh.position.y = 3.7;
      // Depois do preenchimento verde dos lotes, que é translúcido e misturaria as cores.
      mesh.renderOrder = 10;
      group.add(mesh);
    }
  }

  /**
   * Ficha do lote com o jogador logado: a situação vem do world. Devolve true
   * quando assume a compra, para a gestão simulada não mostrar a dela.
   */
  function decorateLot(i, ficha) {
    if (!session) return false;
    const box = document.createElement('div');
    box.className = 'gestao srv-lote';
    box.innerHTML = '<p class="muted pequeno">Consultando o servidor…</p>';
    ficha.append(box);
    call(API.world, `/v1/world/cities/${CITY}/lots/${i}`, { token: session.token })
      .then(({ lot }) => {
        const price = BigInt(Math.round(Number(lot.price_scity) * 1e6)) * 10n ** 12n;
        // A linha "Situação" da ficha vem dos arquivos estáticos; com login, vale a do servidor.
        const situacao = ficha.querySelector('dd');
        if (situacao) {
          situacao.textContent = lot.mine
            ? 'Seu (servidor)'
            : { civic: 'Da Prefeitura', sold: 'Vendido', reserved: 'Em compra' }[lot.status] ?? (lot.district_open ? 'À venda' : 'Bairro ainda fechado');
        }
        let html = '<h3>No servidor</h3>';
        if (lot.mine) html += '<p><span class="tag tag--srv">Seu</span> Este lote é seu no servidor.</p>';
        else if (lot.status === 'civic') html += '<p class="muted">Da Prefeitura: não está à venda.</p>';
        else if (lot.status === 'sold') html += '<p class="muted">Vendido a outro jogador.</p>';
        else if (lot.status === 'reserved') html += '<p class="muted">Outro jogador está comprando agora.</p>';
        else if (!lot.district_open) html += '<p class="muted">Bairro ainda fechado para venda.</p>';
        else {
          const enough = BigInt(data.scity) >= price;
          html += `<p class="muted pequeno">US$ ${lot.price_usd.toLocaleString('pt-BR')}, pagos em SCITY pela cotação.</p>
            <button class="btn btn--primary" type="button" data-buy="${i}" ${enough ? '' : 'disabled'}>Comprar por ${Number(lot.price_scity).toLocaleString('pt-BR')} SCITY</button>
            ${enough ? '' : '<p class="muted pequeno">SCITY insuficiente: use “+1.000 SCITY de teste” no painel.</p>'}`;
        }
        box.innerHTML = html;
        if (lot.status === 'sold') showVisit(i, box);
      })
      .catch((error) => {
        box.innerHTML = `<p class="aviso-s">${esc(error.code === 'offline' ? 'Serviço world fora do ar.' : error.message)}</p>`;
      });
    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-entrar]')) return map.enterLot?.(i);
      const rm = e.target.closest('[data-remover]');
      if (rm) {
        rm.disabled = true;
        await call(API.world, `/v1/world/places/${rm.dataset.kind}/${rm.dataset.place}/guests/${rm.dataset.remover}`, { method: 'DELETE', token: session.token }).catch(() => null);
        return showVisit(i, box);
      }
      const b = e.target.closest('[data-buy]');
      if (!b || b.disabled) return;
      b.disabled = true;
      b.textContent = 'Comprando…';
      try {
        const r = await call(API.world, `/v1/world/cities/${CITY}/lots/${i}/buy`, { method: 'POST', token: session.token });
        message = `${r.lot.code} é seu por ${Number(r.purchase.price_scity).toLocaleString('pt-BR')} SCITY.`;
        messageOk = true;
      } catch (error) {
        message = error.message;
        messageOk = false;
      }
      await refresh();
      map.showLot(i);
    });
    return true;
  }

  /** Seção de visita da ficha: entrar (dono ou convidado) e, para o dono, os convidados. */
  async function showVisit(i, box) {
    box.querySelector('.srv-visita')?.remove();
    const sec = document.createElement('div');
    sec.className = 'srv-visita';
    box.append(sec);
    let v;
    try {
      v = await visit(i);
    } catch {
      return sec.remove(); // sem imóvel pronto, ou sem convite: nada a mostrar
    }
    const { place, role } = v;
    let html = `<h3>🚪 ${esc(place.label)}</h3>
      <button class="btn btn--primary pequeno" type="button" data-entrar>Entrar</button>
      ${role === 'guest' ? '<p class="muted pequeno">Você é convidado do dono.</p>' : ''}`;
    if (role === 'owner') {
      const guests = await call(API.world, `/v1/world/places/${place.kind}/${place.id}/guests`, { token: session.token })
        .then((r) => r.guests)
        .catch(() => []);
      html += `<p class="muted pequeno">Convidados (${guests.length}): só eles e você entram.</p>
        <ul class="lista">${guests
          .map((g) => `<li><span>conta …${esc(g.account_id.slice(-6))}</span> <button class="btn btn--ghost pequeno" type="button" data-remover="${esc(g.account_id)}" data-kind="${place.kind}" data-place="${place.id}">Remover</button></li>`)
          .join('')}</ul>
        <form data-convidar><div class="linha"><input class="campo" name="wallet" required pattern="0x[0-9a-fA-F]{40}" placeholder="Carteira do convidado (0x…)" aria-label="Carteira do convidado" />
        <button class="btn btn--ghost pequeno" type="submit">Convidar</button></div><p class="muted pequeno" data-convite-msg></p></form>`;
    }
    sec.innerHTML = html;
    sec.querySelector('[data-convidar]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const wallet = new FormData(e.target).get('wallet');
      const msg = sec.querySelector('[data-convite-msg]');
      try {
        await call(API.world, `/v1/world/places/${place.kind}/${place.id}/guests`, { method: 'POST', token: session.token, body: { wallet } });
        await showVisit(i, box);
      } catch (error) {
        msg.textContent = error.message;
      }
    });
  }

  /** Posso entrar no imóvel do lote? { place, role } ou erro com código (not_invited, nothing_to_visit…). */
  function visit(i) {
    if (!session) return Promise.reject(Object.assign(new Error('Entre no jogo para visitar imóveis.'), { code: 'no_session' }));
    return call(API.world, `/v1/world/cities/${CITY}/lots/${i}/visit`, { token: session.token });
  }

  render();
  refresh();
  // Atualiza o turno e o saldo enquanto a página está aberta.
  setInterval(() => {
    if (session && !busy && !document.hidden) refresh();
  }, 10_000);

  return { refresh, decorateLot, visit, active: () => session !== null, getSession: () => session, getData: () => data, API };
}
