// Liga o mapa aos serviços (célula jogável, E1.6): o jogador entra com a
// carteira (SIWE, pelo gateway) ou com um código por e-mail, vê o avatar (game-core) e o THALER do ledger
// (economy), trabalha um turno e coleta. Aqui nada é simulado: quem decide é o
// servidor (ADR-0002). A gestão de lotes e negócios do painel "Meu
// patrimônio" continua simulada no navegador até o serviço world.

import { connectWallet, hasWallet, readContract, sendTx, txError } from './carteira.js';

const params = new URLSearchParams(location.search);
const INDEXER = params.get('indexer') ?? 'http://127.0.0.1:8040';
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
  if (m >= 48 * 60) return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
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
  let data = { avatar: null, balance: '0', scity: '0', lots: [], shifts: [], fx: null, withdrawals: null, deposits: null, kyc: null, invitations: [] };
  /** Alimentos do mercado do jogo, com o preço de uma unidade em centavos de THALER. */
  let foods = [];
  /** Limites da despensa pela casa (10, 30 e 60) e o tempo de compra, do catálogo do mercado. */
  let pantryLimits = null;
  let petshop = null;
  // Pet Sitter (E3.1): os sitters atendendo e, para o avatar Pet Sitter, o painel dele.
  let sitters = null;
  let sitterPanel = null;
  let school = null;
  let jobs = [];
  let leisure = null;
  let venues = [];
  let propertyTypes = null;
  let cup = null;
  let carCatalog = null;
  /** Moradia do avatar (doc 04 §4): casa própria, aluguel ou hotel, e o fator do turno. */
  let moradia = null;
  /** Hotéis de jogador da cidade (GDD §6 "Hotel"), com a lotação. */
  let hoteisJogador = [];
  /** Apartamentos de jogadores para alugar na cidade. */
  let aluguelUnidades = [];
  /** Descanso, higiene e deslocamento (GDD §2.3 e §3.3): o catálogo, uma vez. */
  let rotina = null;
  /** Loja do jogo (roupas, ferramenta e cama): o catálogo, uma vez. */
  let loja = null;
  /** O modo de ir ao trabalho escolhido aqui (fica no navegador). */
  let commuteMode = (() => {
    try {
      return localStorage.getItem('scc-deslocamento') || 'a_pe';
    } catch {
      return 'a_pe';
    }
  })();
  let events = null;
  let farm = null;
  let pass = null;
  let cars = null;
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
    data = { avatar: null, balance: '0', scity: '0', lots: [], shifts: [], fx: null, withdrawals: null, deposits: null, kyc: null, invitations: [] };
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
      // Pet Shop (E3.1): preços e serviços, uma vez.
      if (!petshop) petshop = await call(API.game, '/v1/catalog/petshop').catch(() => null);
      // Pet Sitter: a lista (com a estadia do pet deste avatar) e, se ele for Pet Sitter, o painel.
      [sitters, sitterPanel] = data.avatar
        ? await Promise.all([
            call(API.game, `/v1/pet-sitters?avatar_id=${data.avatar.id}`, { token: session.token }).catch(() => null),
            data.avatar.job?.code === 'pet_sitter'
              ? call(API.game, `/v1/avatars/${data.avatar.id}/pet-sitter`, { token: session.token }).catch(() => null)
              : null,
          ])
        : [null, null];
      // Escola (E3.2): preços e as profissões, para a troca na mesma raridade.
      if (!school) school = await call(API.game, '/v1/catalog/school').catch(() => null);
      // Lazer (E3.3): as atividades (game-core) e as academias e galerias da cidade (world).
      if (!leisure) leisure = await call(API.game, '/v1/catalog/leisure').catch(() => null);
      venues = await call(API.world, `/v1/world/cities/${CITY}/venues`, { token: session.token })
        .then((r) => r.venues)
        .catch(() => []);
      // Campeonato de botão (E3.3): o do mês e o resultado do anterior.
      cup = await call(API.game, '/v1/championships/current', { token: session.token }).catch(() => null);
      // Fazenda (E3.4): o catálogo e o slot da conta.
      farm = await call(API.game, '/v1/farm', { token: session.token }).catch(() => null);
      // Evento da semana e GamePass da temporada (E3.10).
      [events, pass] = await Promise.all([
        call(API.game, '/v1/events').catch(() => null),
        call(API.game, '/v1/gamepass', { token: session.token }).catch(() => null),
      ]);
      // Moradia: o fator do próximo turno, a estadia e as casas próprias.
      moradia = data.avatar
        ? await call(API.game, `/v1/avatars/${data.avatar.id}/housing`, { token: session.token }).catch(() => null)
        : null;
      // Hotéis de jogador da cidade, com hóspedes e quartos.
      hoteisJogador = await call(API.game, `/v1/housing/hotels?city=${CITY}`, { token: session.token })
        .then((r) => r.hotels)
        .catch(() => []);
      // Apartamentos de jogadores para alugar (E3.11).
      aluguelUnidades = await call(API.world, `/v1/world/cities/${CITY}/units/for-rent`, { token: session.token })
        .then((r) => r.units)
        .catch(() => []);
      if (!rotina) rotina = await call(API.game, '/v1/catalog/routine').catch(() => null);
      if (!loja) loja = await call(API.game, '/v1/catalog/shop').catch(() => null);
      // Veículos (E3.5): a agência e os carros da conta.
      if (!carCatalog) carCatalog = await call(API.game, '/v1/catalog/vehicles').catch(() => null);
      cars = await call(API.game, '/v1/vehicles', { token: session.token })
        .then((r) => r.vehicles)
        .catch(() => null);
      if (!jobs.length) jobs = await call(API.game, '/v1/catalog/professions').then((r) => r.professions).catch(() => []);
      if (!foods.length) {
        foods = await call(API.game, '/v1/catalog/foods')
          .then((r) => {
            pantryLimits = r.pantry_limits ?? null;
            return r.foods;
          })
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
      // Com a carteira, o economy diz quanto o cofre ainda libera hoje para ela.
      const wallet = me?.wallets?.[0] ?? session.address ?? null;
      [data.fx, data.withdrawals, data.kyc, data.deposits, data.switches] = await Promise.all([
        call(API.economy, '/v1/economy/fx').catch(() => null),
        call(API.economy, `/v1/economy/withdrawals${wallet ? `?wallet=${wallet}` : ''}`, { token: session.token }).catch((error) => {
          if (error.status === 401) throw error;
          return null;
        }),
        // KYC no gateway: nível da conta e o último pedido de verificação.
        call(API.gateway, '/v1/me/kyc', { token: session.token }).catch(() => null),
        // Depósitos da carteira no GameVault (chain-indexer): fora do ar, a lista some.
        wallet
          ? fetch(`${INDEXER}/v1/chain/deposits/${wallet}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((r) => r?.deposits ?? null)
              .catch(() => null)
          : null,
        // Travas de incidente (E4.6): saque ou câmbio suspensos pela operação.
        call(API.economy, '/v1/economy/status').then((r) => r.switches).catch(() => null),
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
    // Trava de incidente (E4.6): o aviso com o motivo público; os botões ficam desligados.
    const frozen = (name, what) => {
      const sw = data.switches?.[name];
      return sw?.frozen ? `<p class="aviso-s pequeno">⛔ <strong>${what} suspenso temporariamente</strong>${sw.reason ? `: ${esc(sw.reason)}` : ''}. Seu saldo está seguro.</p>` : '';
    };
    const fxOff = data.switches?.exchange?.frozen;
    const wdOff = data.switches?.withdrawals?.frozen;
    let html = `<h3>💱 Câmbio</h3>${frozen('exchange', 'Câmbio')}
      <p class="muted pequeno">1 SCITY = ${fx.thaler_per_scity.toLocaleString('pt-BR')} THALER (US$ ${fx.scity_usd.toLocaleString('pt-BR')}${fx.provisional ? ', cotação provisória' : ''}).
      Para SCITY: ${(fx.exit_spread_bps / 100).toLocaleString('pt-BR')}% de spread, mínimo de ${thaler(fx.min_exit_cents)} e até ${thaler(fx.daily_exit_cents)} THALER por dia${brake}.</p>
      <form data-form="cambio" class="banco">
        <input class="campo" name="valor" inputmode="decimal" required placeholder="Valor (ex.: 12,5)" aria-label="Valor a converter" />
        <div class="linha">
        <button class="btn btn--ghost pequeno" type="submit" name="dir" value="scity_to_thaler" ${busy || fxOff ? 'disabled' : ''}>SCITY → THALER</button>
        <button class="btn btn--ghost pequeno" type="submit" name="dir" value="thaler_to_scity" ${busy || fxOff ? 'disabled' : ''}>THALER → SCITY</button></div>
      </form>`;
    if (data.withdrawals === null) return html;
    const vault = data.withdrawals.vault;
    html += '<h3>📥 Depósito da carteira</h3>';
    if (!wallets.length) return `${html}<p class="muted pequeno">Ligue uma carteira à conta para depositar e sacar SCITY.</p>`;
    if (vault?.paused) html += '<p class="muted pequeno">⏸ <strong>Cofre pausado:</strong> depósito e resgate esperam ele reabrir.</p>';
    html += `<form data-form="deposito" class="banco">
        <input class="campo" name="valor" inputmode="decimal" required placeholder="SCITY a depositar" aria-label="SCITY a depositar" />
        <button class="btn btn--blue pequeno" type="submit" ${busy || !hasWallet() || vault?.paused ? 'disabled' : ''}>Depositar de ${short(wallets[0])}</button>
      </form>
      <p class="muted pequeno">${hasWallet() ? 'Uma assinatura e uma transação: o SCITY vira saldo no jogo depois das confirmações da rede.' : 'Para depositar, abra o mapa num navegador com a MetaMask.'}</p>`;
    const deposits = (data.deposits ?? []).slice(0, 3);
    if (deposits.length) {
      html += `<ul class="lista-saques">${deposits
        .map((d) => `<li><span>${scity(d.amount_wei)} SCITY · ${d.status === 'credited' ? 'no jogo' : 'aguardando confirmações'}</span></li>`)
        .join('')}</ul>`;
    }
    html += `<h3>🏦 Saque para a carteira</h3>${frozen('withdrawals', 'Saque')}`;
    if (vault && !vault.paused) {
      html += `<p class="muted pequeno">Hoje o cofre ainda libera ${scity(vault.wallet_left_wei)} SCITY para esta carteira (teto do contrato: ${scity(vault.per_address_limit_wei)} por carteira e ${scity(vault.daily_limit_wei)} no total por dia).</p>`;
    }
    html += `<form data-form="saque" class="banco">
        <input class="campo" name="valor" inputmode="decimal" required placeholder="SCITY a sacar" aria-label="SCITY a sacar" />
        <button class="btn btn--blue pequeno" type="submit" ${busy || wdOff ? 'disabled' : ''}>Sacar para ${short(wallets[0])}</button>
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
      const label = {
        pending: 'pronto para resgatar',
        claimed: 'resgatado',
        refunded: 'venceu, voltou ao jogo',
        cancelled: 'você desistiu, voltou ao jogo',
        failed: 'falhou',
        created: 'processando',
      };
      html += `<ul class="lista-saques">${list
        .map(
          (w) => `<li><span>${scity(w.amount_wei)} SCITY · ${esc(label[w.status] ?? w.status)}${w.status === 'pending' ? ` · vence em ${left(w.deadline)}` : ''}</span>
            ${
              w.voucher && hasWallet()
                ? `<span class="linha"><button class="btn btn--primary pequeno" type="button" data-s="resgatar" data-w="${esc(w.id)}" ${busy ? 'disabled' : ''}>Resgatar</button>
                   <button class="btn btn--ghost pequeno" type="button" data-s="desistir" data-w="${esc(w.id)}" ${busy ? 'disabled' : ''} title="Cancela o voucher no cofre e o SCITY volta ao jogo">Desistir</button></span>`
                : ''
            }</li>`,
        )
        .join('')}</ul>`;
      if (list.some((w) => w.voucher) && !hasWallet()) {
        html += '<p class="muted pequeno">Para resgatar, abra o mapa num navegador com a MetaMask.</p>';
      }
    }
    return html;
  };

  const VAULT_ABI = [
    'function token() view returns (address)',
    'function claim((address to,uint256 amount,uint256 nonce,uint256 deadline) w, bytes sig)',
    'function cancelVoucher((address to,uint256 amount,uint256 nonce,uint256 deadline) w, bytes sig)',
    'function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  ];
  const TOKEN_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function nonces(address) view returns (uint256)',
    'function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)',
  ];
  const VAULT_ERRORS = {
    VoucherExpired: 'O voucher venceu: o SCITY volta ao jogo sozinho.',
    NonceAlreadyUsed: 'Este voucher já foi usado ou cancelado.',
    NotRecipient: 'Conecte a carteira do saque para resgatar.',
    DailyLimitExceeded: 'O cofre já liberou o teto de hoje. Tente amanhã (o voucher vale 48 h) ou desista.',
    AddressLimitExceeded: 'Esta carteira passou do teto de hoje no cofre. Tente amanhã ou desista.',
    EnforcedPause: 'O cofre está pausado.',
    ERC20InsufficientBalance: 'SCITY insuficiente na carteira.',
  };

  /** A carteira conectada, na rede do cofre e ligada à conta (o depósito vira saldo de quem tem a carteira). */
  async function vaultWallet(expected) {
    const w = await connectWallet(data.withdrawals.chain_id);
    if (expected && w.address.toLowerCase() !== expected.toLowerCase()) {
      throw new ApiError(400, 'wrong_wallet', `Conecte a carteira ${short(expected)}: a conectada é ${short(w.address)}.`);
    }
    return w;
  }

  const voucherArgs = (v) => [{ to: v.to, amount: BigInt(v.amount), nonce: BigInt(v.nonce), deadline: BigInt(v.deadline) }, v.signature];

  /** Resgate do voucher: a carteira do jogador chama GameVault.claim (ela paga o gás). */
  async function claimVoucher(w) {
    const wallet = await vaultWallet(w.voucher.to);
    return (await sendTx(wallet, data.withdrawals.contract, VAULT_ABI, 'claim', voucherArgs(w.voucher))).transactionHash;
  }

  /** Desistência: cancelVoucher queima o nonce no cofre; o job do economy devolve o SCITY ao jogo. */
  async function cancelVoucher(w) {
    const wallet = await vaultWallet(w.voucher.to);
    return (await sendTx(wallet, data.withdrawals.contract, VAULT_ABI, 'cancelVoucher', voucherArgs(w.voucher))).transactionHash;
  }

  /** Depósito: assina o permit (EIP-2612) do SCITY e chama depositWithPermit, numa transação. */
  async function depositScity(amount, expected) {
    const w = await vaultWallet(expected);
    const vault = data.withdrawals.contract;
    const token = await readContract(w, vault, VAULT_ABI, 'token');
    const balance = await readContract(w, token, TOKEN_ABI, 'balanceOf', [w.address]);
    if (balance < amount) throw new ApiError(409, 'insufficient', `A carteira tem ${scity(balance)} SCITY.`);
    const [, name, version, chainId] = await readContract(w, token, TOKEN_ABI, 'eip712Domain');
    const nonce = await readContract(w, token, TOKEN_ABI, 'nonces', [w.address]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
    const signature = await w.client.signTypedData({
      account: w.client.account ?? w.address,
      domain: { name, version, chainId: Number(chainId), verifyingContract: token },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: { owner: w.address, spender: vault, value: amount, nonce, deadline },
    });
    const { r, s: sv, v, yParity } = w.viem.parseSignature(signature);
    const vv = v !== undefined ? Number(v) : 27 + yParity;
    return (await sendTx(w, vault, VAULT_ABI, 'depositWithPermit', [amount, deadline, vv, r, sv])).transactionHash;
  }

  /** Erro de transação no cofre em texto curto. */
  const vaultError = (error) => (error instanceof ApiError ? error : new ApiError(400, 'tx', txError(error, VAULT_ERRORS)));

  /**
   * Fazenda (E3.4): slot da Prefeitura com 4 canteiros. Arar (com enxada),
   * plantar pelo nível, colher para a despensa do avatar e subir de nível.
   */
  const farmSection = (a) => {
    const off = busy ? 'disabled' : '';
    const f = farm.farm;
    const crops = { uva: 'Uva', morango: 'Morango', tomate: 'Tomate', cenoura: 'Cenoura', laranja: 'Laranja', beterraba: 'Beterraba', milho: 'Milho', maca: 'Maçã', trigo: 'Trigo', batata: 'Batata' };
    const damage = { apodreceu: 'apodreceu', passaros: 'pássaros', corvos: 'corvos', coelhos: 'coelhos' };
    if (!f) {
      return `<h3>🌾 Fazenda</h3>
        <p class="muted pequeno">Slot da Prefeitura com 4 canteiros e a casa, na ${esc(farm.region)}.</p>
        <button class="btn btn--blue pequeno" type="button" data-s="fazenda-comprar" ${off}>Comprar slot · ${thaler(farm.price)}</button>`;
    }
    const farmer = farm.farmer_jobs.includes(a.job.code);
    let html = `<h3>🌾 Fazenda <span class="muted pequeno">· nível ${f.level} · ${esc(f.season.label)} (produção ×${f.season.factor.toLocaleString('pt-BR')} até ${new Date(f.season.ends_at).toLocaleDateString('pt-BR')}) · ${f.harvests_at_level}/${farm.harvests_to_level} colheitas</span></h3>`;
    const options = f.crops.map((c) => `<option value="${esc(c.code)}">${esc(crops[c.code] ?? c.code)} (${c.days.toLocaleString('pt-BR')} d)</option>`).join('');
    html += `<ul class="lista-saques">${f.plots
      .map((pl) => {
        const n = pl.index + 1;
        let state;
        let action = '';
        if (pl.crop && pl.ready) {
          state = `${esc(crops[pl.crop] ?? pl.crop)} pronta: ${pl.units_now} un.${pl.damage ? ` (${damage[pl.damage] ?? pl.damage})` : ''}`;
          action = `<button class="btn btn--primary pequeno" type="button" data-s="fazenda-colher" data-p="${n}" ${off}>Colher</button>`;
        } else if (pl.crop) {
          state = `${esc(crops[pl.crop] ?? pl.crop)} crescendo: pronta em ${left(pl.ready_at)}`;
        } else if (pl.plowed) {
          state = 'arado';
          action = `<select class="campo" data-crop="${n}" aria-label="Cultura do canteiro ${n}">${options}</select>
            <button class="btn btn--blue pequeno" type="button" data-s="fazenda-plantar" data-p="${n}" ${off}>Plantar · ${thaler(farm.seed_price)}</button>`;
        } else {
          state = 'para arar';
          action = f.machines.includes('enxada')
            ? `${farmer ? `<button class="btn btn--ghost pequeno" type="button" data-s="fazenda-arar" data-p="${n}" data-own="1" ${off}>Arar (−1 energia)</button>` : ''}
               <button class="btn btn--ghost pequeno" type="button" data-s="fazenda-arar" data-p="${n}" ${off}>Contratar · ${thaler(farm.hired_plow_price)}</button>`
            : '<span class="muted pequeno">precisa de enxada</span>';
        }
        return `<li><span>Canteiro ${n} · ${state}</span><span class="linha">${action}</span></li>`;
      })
      .join('')}</ul>`;
    const missing = farm.machines.filter((m) => !f.machines.includes(m.code));
    if (missing.length) {
      html += `<div class="linha"><select class="campo" data-maquina aria-label="Máquina">${missing
        .map((m) => `<option value="${esc(m.code)}">${esc(m.label)} · ${thaler(m.price)}</option>`)
        .join('')}</select><button class="btn btn--ghost pequeno" type="button" data-s="fazenda-maquina" ${off}>Comprar máquina</button></div>`;
    }
    if (f.machines.length) html += `<p class="muted pequeno">Máquinas: ${f.machines.map((c) => esc(farm.machines.find((m) => m.code === c)?.label ?? c)).join(', ')}.</p>`;
    if (f.can_level_up) html += `<button class="btn btn--blue pequeno" type="button" data-s="fazenda-nivel" ${off}>Subir para o nível ${f.level + 1} · ${thaler(f.level_up_cents)}</button>`;
    html += herdSection(a);
    html += '<p class="muted pequeno">A colheita vai para a despensa deste avatar. Riscos: apodrecer, pássaros (frutas), corvos (grãos) e coelhos; agrotóxico, espantalho e cão protegem. Sem colher, perde 5% por dia. Preços provisórios.</p>';
    return html;
  };

  /** Pecuária (E3.4): estruturas, animais, alimentação com o grão da despensa, coleta, abate e reprodução. */
  const herdSection = (a) => {
    const l = farm.livestock;
    if (!l) return '';
    const off = busy ? 'disabled' : '';
    const pantry = Object.fromEntries((a.pantry ?? []).map((x) => [x.food, x.units]));
    let html = '<h3>🐔 Pecuária</h3>';
    const missing = farm.structures.filter((x) => !l.structures.includes(x.code));
    if (missing.length) {
      html += `<div class="linha"><select class="campo" data-estrutura aria-label="Estrutura">${missing
        .map((x) => `<option value="${esc(x.code)}">${esc(x.label)} · ${thaler(x.price)}</option>`)
        .join('')}</select><button class="btn btn--ghost pequeno" type="button" data-s="fazenda-estrutura" ${off}>Construir</button></div>`;
    }
    const buyable = farm.breeds.filter((b) => b.needs.every((n) => l.structures.includes(n)));
    if (buyable.length) {
      html += `<div class="linha"><select class="campo" data-raca aria-label="Animal">${buyable
        .map((b) => `<option value="${esc(b.code)}">${esc(b.label)} · ${thaler(b.price)}</option>`)
        .join('')}</select><button class="btn btn--ghost pequeno" type="button" data-s="fazenda-animal" ${off}>Comprar animal</button></div>`;
    }
    const grains = farm.feed_foods.filter((g) => (pantry[g] ?? 0) > 0);
    if (l.animals.length) {
      html += `<ul class="lista-saques">${l.animals
        .map((x) => {
          const info = [x.adult ? `adulto, nível ${x.level}` : `filhote (${x.feeds}/3 refeições)`, x.golden ? 'ovos de ouro' : '', x.stock ? `${x.stock} guardado(s)` : '', x.dies_at ? `até ${left(x.dies_at)}` : '']
            .filter(Boolean)
            .join(' · ');
          const feed = x.fed_today
            ? '<span class="muted pequeno">comeu hoje</span>'
            : grains.map((g) => `<button class="btn btn--ghost pequeno" type="button" data-s="fazenda-alimentar" data-id="${esc(x.id)}" data-f="${esc(g)}" ${off}>${g === 'milho' ? 'Milho' : 'Trigo'}</button>`).join('') ||
              '<span class="muted pequeno">sem milho ou trigo na despensa</span>';
          return `<li><span>${esc(x.label)} · ${info}</span><span class="linha">${feed}<button class="btn btn--ghost pequeno" type="button" data-s="fazenda-abater" data-id="${esc(x.id)}" ${off}>Abater</button></span></li>`;
        })
        .join('')}</ul>`;
      const stock = l.animals.reduce((n, x) => n + x.stock, 0);
      const extra = [
        stock ? `<button class="btn btn--primary pequeno" type="button" data-s="fazenda-coletar" ${off}>Coletar ovos e leite (${stock})</button>` : '',
        l.structures.includes('galinheiro') && !l.coop_clean ? `<button class="btn btn--blue pequeno" type="button" data-s="fazenda-limpar" ${off}>Limpar galinheiro · ${thaler(farm.coop_clean_price)}</button>` : '',
        l.structures.includes('chocadeira') && (pantry.ovos ?? 0) > 0 ? `<button class="btn btn--ghost pequeno" type="button" data-s="fazenda-chocar" ${off}>Chocar 1 ovo</button>` : '',
      ].join('');
      if (extra) html += `<div class="linha">${extra}</div>`;
      const adults = l.animals.filter((x) => x.adult);
      if (adults.length >= 2 && grains.length) {
        const opts = adults.map((x) => `<option value="${esc(x.id)}">${esc(x.label)} (${x.id.slice(0, 4)})</option>`).join('');
        html += `<div class="linha"><select class="campo" data-par="0" aria-label="Animal 1">${opts}</select><select class="campo" data-par="1" aria-label="Animal 2">${opts}</select>
          <button class="btn btn--ghost pequeno" type="button" data-s="fazenda-reproduzir" data-f="${esc(grains[0])}" ${off}>Reproduzir (1 ${grains[0]})</button></div>`;
      }
    }
    if (l.structures.includes('galinheiro')) {
      html += `<p class="muted pequeno">Galinheiro ${l.coop_clean ? `limpo até ${new Date(l.coop_clean_until).toLocaleDateString('pt-BR')}` : '<strong>sujo: as galinhas não põem</strong>'}.</p>`;
    }
    if (l.log.length) html += `<p class="muted pequeno">${esc(l.log.at(-1).text)}</p>`;
    return html;
  };

  /**
   * Evento semanal por profissão e GamePass da temporada (E3.10): o evento dá
   * 1,2× no turno do grupo da semana; o GamePass corta a chance de dano e libera
   * os distintivos da temporada.
   */
  const eventSection = (a) => {
    const e = events.current;
    const mine = e.jobs.includes(a.job.code);
    const next = events.next.map((x) => `${esc(x.group_label)} (${esc(x.name)})`).join(' → ');
    let html = `<h3>🎉 ${esc(e.name)} <span class="muted pequeno">· semana de ${esc(e.group_label)}</span></h3>
      <p class="muted pequeno">${mine ? `<strong>Sua profissão está no evento:</strong> turno ×${e.factor.toLocaleString('pt-BR')} até ${new Date(e.ends_at).toLocaleDateString('pt-BR')}.` : `As profissões de ${esc(e.group_label)} ganham ×${e.factor.toLocaleString('pt-BR')} no turno até ${new Date(e.ends_at).toLocaleDateString('pt-BR')}.`} Próximas: ${next}.</p>`;
    if (pass?.season) {
      const lvl = pass.level;
      const off = busy ? 'disabled' : '';
      const price = (target) => scity((BigInt(target) * BigInt(pass.level_price_wei) - BigInt(lvl) * BigInt(pass.level_price_wei)).toString());
      // Itens sazonais: valem só nesta temporada. O efeito aparece ao lado; o bloqueado mostra o nível.
      const effect = (i) => (i.effect === 'earn' ? ` +${Math.round(i.value * 100)}% no ganho` : i.effect === 'damage' ? ` −${Math.round(i.value * 100)}% de dano` : '');
      const items = pass.items
        .map((i) => (i.unlocked ? `<strong>${esc(i.label)}</strong>${effect(i)}` : `<span class="muted">${esc(i.label)}${effect(i)} (nível ${i.level})</span>`))
        .join(' · ');
      const perks = [
        pass.damage_cut ? `dano no turno −${Math.round(pass.damage_cut * 100)}%` : '',
        pass.earn_bonus ? `ganho +${Math.round(pass.earn_bonus * 100)}%` : '',
      ].filter(Boolean);
      html += `<p class="muted pequeno">🎟️ GamePass ${esc(pass.season.label)} (até ${new Date(pass.season.ends_at).toLocaleDateString('pt-BR')}): nível ${lvl}/${pass.max_level}${perks.length ? ` · ${perks.join(' · ')}` : ''}.</p>
        ${items ? `<p class="pequeno">Itens da temporada: ${items}.</p>` : ''}`;
      if (lvl < pass.max_level) {
        html += `<div class="linha">${[lvl + 1, pass.max_level]
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .map((t) => `<button class="btn btn--ghost pequeno" type="button" data-s="gamepass" data-l="${t}" ${off}>Nível ${t} · ${price(t)} SCITY</button>`)
          .join('')}</div>`;
      }
    }
    return html;
  };

  /** Loja do jogo (GDD §6 "Lojas"): roupas +10/15/20%, ferramenta +30% por 3 dias e a cama do 2º turno de 6 h. */
  const shopSection = (a) => {
    const off = busy ? 'disabled' : '';
    const g = a.gear;
    const pct = (f) => `+${Math.round((f - 1) * 100)}%`;
    let html = `<h3>🛍️ Loja</h3><p class="muted pequeno">Itens no ganho do turno: <strong>${g.factor > 1 ? pct(g.factor) : 'nenhum'}</strong>${
      g.tool ? ` · ferramenta até ${new Date(g.tool.until).toLocaleDateString('pt-BR')}${g.tool.active ? '' : ' (de outra profissão)'}` : ''
    }${g.bed ? ' · 🛏️ cama' : ''}.</p>`;
    html += `<div class="linha moradia-opcoes">${loja.clothes
      .map((c) => `<button class="btn btn--ghost pequeno" type="button" data-s="loja" data-i="roupa" data-l="${c.level}" ${off || (g.clothes >= c.level ? 'disabled' : '')}>Roupa ${c.level} (+${Math.round(c.bonus * 100)}%) · ${thaler(c.price)}</button>`)
      .join('')}
      <button class="btn btn--ghost pequeno" type="button" data-s="loja" data-i="ferramenta" ${off}>Ferramenta (+${Math.round(loja.tool.bonus * 100)}%, ${loja.tool.days} dias) · ${thaler(loja.tool.price)}</button>
      ${g.bed ? '' : `<button class="btn btn--ghost pequeno" type="button" data-s="loja" data-i="cama" ${off}>Cama · ${thaler(loja.bed.price)}</button>`}
      ${loja.skate ? (g.skate_trips ? `<span class="muted pequeno">🛹 Skate: ${g.skate_trips} viagens</span>` : `<button class="btn btn--ghost pequeno" type="button" data-s="loja" data-i="skate" ${off}>Skate · ${thaler(loja.skate.price)} (${loja.skate.trips} viagens)</button>`) : ''}</div>
      <p class="muted pequeno">A roupa vale para sempre; a ferramenta, para a profissão de agora. A cama libera o 2º turno de 6 h no dia. Preços provisórios.</p>`;
    // Móveis e eletrodomésticos (GDD §6 "Lojas"): casa completa +1 de felicidade ao acordar; fogão e micro-ondas cozinham.
    if (loja.home) {
      const tem = new Set(g.home ?? []);
      const botao = (i) =>
        tem.has(i.code) ? '' : `<button class="btn btn--ghost pequeno" type="button" data-s="loja" data-i="${esc(i.code)}" ${off}>${esc(i.label)} · ${thaler(i.price)}</button>`;
      const faltam = loja.complete_home.items.filter((i) => (i === 'cama' ? !g.bed : !tem.has(i))).length;
      html += `<p class="pequeno">🛋️ Móveis${g.complete_home ? ' · <span class="tag tag--srv">Casa completa</span>' : faltam ? ` · faltam ${faltam} para a casa completa` : ''}</p>
        <div class="linha moradia-opcoes">${loja.home.filter((i) => i.kind === 'movel').map(botao).join('')}</div>
        <p class="pequeno">🍳 Eletrodomésticos${g.cooks_with ? ` · cozinha no ${g.cooks_with === 'fogao' ? 'fogão' : 'micro-ondas'}` : ''}</p>
        <div class="linha moradia-opcoes">${loja.home.filter((i) => i.kind === 'eletro').map(botao).join('')}</div>
        <p class="muted pequeno">Casa completa (cama, sofá, mesa e guarda-roupa): +${loja.complete_home.happiness_on_wake} de felicidade ao acordar em casa. Cozinhar a despensa: +${loja.cooking.food.fogao} no fogão, +${loja.cooking.food.micro_ondas} no micro-ondas, sem dor de barriga; a geladeira dá +${loja.cooking.fridge_health} de saúde. Preços provisórios.</p>`;
    }
    return html;
  };

  /** Descanso (4 ou 8 h, energia ao acordar) e higiene em casa (GDD §2.3). */
  const routineSection = (a) => {
    const off = busy ? 'disabled' : '';
    const housed = moradia?.factor === 1;
    let html = '<h3>😴 Descanso e higiene</h3>';
    if (a.rest) {
      html += `<p class="muted pequeno">Dormindo até ${new Date(a.rest.ends_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>`;
    } else {
      // Descanso obrigatório: com 16 h acordado, dorme mesmo com a energia cheia.
      const must = a.status.mustRest;
      if (must) html += `<p class="pequeno"><span class="tag tag--srv">Hora de dormir</span> Acordado há ${rotina.rest.awake_limit_hours ?? 16} h ou mais: sem trabalho e sem lazer até descansar.</p>`;
      else if (a.must_rest_at) html += `<p class="muted pequeno">Precisa dormir em ${left(a.must_rest_at)} (descanso obrigatório após ${rotina.rest.awake_limit_hours ?? 16} h acordado).</p>`;
      html += `<div class="linha">${rotina.rest.hours
        .map((h) => `<button class="btn btn--ghost pequeno" type="button" data-s="descansar" data-h="${h}" ${off || (a.attributes.energy >= 10 && !must ? 'disabled' : '')}>Dormir ${h} h · +${housed ? rotina.rest.energy[h] : Math.floor(rotina.rest.energy[h] * rotina.rest.unhoused_share)} energia</button>`)
        .join('')}</div>`;
    }
    html += `<div class="linha moradia-opcoes">${rotina.chores
      .map((c) => {
        const wait = a.chores?.[c.code];
        return `<button class="btn btn--ghost pequeno" type="button" data-s="higiene" data-c="${esc(c.code)}" ${off || (wait || !housed || a.rest ? 'disabled' : '')} title="${wait ? `de novo em ${left(wait)}` : ''}">${esc(c.label)}</button>`;
      })
      .join('')}</div>
      <p class="muted pequeno">${housed ? 'Higiene de graça em casa, cada uma a cada 4 h.' : 'Sem moradia regular: dorme mal (metade da energia) e não toma banho.'} Valores provisórios.</p>`;
    return html;
  };

  /**
   * Moradia (doc 04 §4): sem casa própria regular, aluguel ou hotel, o turno rende 50%.
   * A casa própria se regulariza na ficha do lote (Prefeitura, água e energia).
   */
  const housingSection = () => {
    const m = moradia;
    const off = busy ? 'disabled' : '';
    const day = (iso) => new Date(iso).toLocaleDateString('pt-BR');
    let html = `<h3>🏠 Moradia</h3><p class="pequeno">${
      m.factor === 1 ? '✅ Moradia regular: o turno rende 100%.' : '⚠️ Sem moradia regular: o turno rende <strong>50%</strong>.'
    }</p>`;
    const casas = m.own_homes ?? [];
    if (casas.length) {
      html += `<p class="muted pequeno">${casas
        .map((c) => `${esc(c.label)}: ${c.regular ? `regular até ${day(c.regular_until)}` : 'falta regularizar ou ligar água e energia (na ficha do lote)'}`)
        .join(' · ')}</p>`;
    }
    if (m.stay) {
      const s = m.stay;
      const deJogador = s.hotel_id ? hoteisJogador.find((h) => h.id === s.hotel_id) : null;
      const nome = s.hotel_id ? `🏨 Hotel de jogador${deJogador ? ` ${esc(deJogador.lot_code)}` : ''} nível ${s.level}` : `🏨 Hotel nível ${s.level}`;
      html += `<p class="muted pequeno">${s.kind === 'hotel' ? nome : '🔑 Aluguel'} até ${day(s.until)}${
        s.kind === 'hotel' ? ` · ${s.meals_left_today} refeição(ões) incluída(s) hoje` : ''
      }.</p><div class="linha moradia-opcoes">
        <button class="btn btn--ghost pequeno" type="button" data-s="moradia" data-k="${s.kind}" data-l="${s.level}" ${s.hotel_id ? `data-hotel="${s.hotel_id}"` : ''} ${off}>Mais dias</button>
        ${s.kind === 'hotel' ? `<button class="btn btn--blue pequeno" type="button" data-s="moradia-refeicao" ${off || (s.meals_left_today ? '' : 'disabled')}>Refeição do hotel</button>` : ''}
        <button class="btn btn--ghost pequeno" type="button" data-s="moradia-sair" ${off}>Sair</button></div>`;
    }
    // Apartamentos de jogadores (E3.11): o aluguel vai ao dono, e a unidade vira a moradia deste avatar.
    const livres = aluguelUnidades.filter((u) => !u.mine && !u.rented_until).slice(0, 4);
    if (livres.length && !m.stay && m.factor !== 1) {
      html += `<p class="pequeno">Apartamentos de jogadores:</p><div class="linha moradia-opcoes">${livres
        .map((u) => `<button class="btn btn--ghost pequeno" type="button" data-s="alugar-unidade" data-u="${u.id}" ${off}>${esc(u.code)} · ${u.area_m2} m² · ${thaler(u.rent_cents_per_day)}/dia</button>`)
        .join('')}</div>`;
    }
    const p = m.prices;
    const dias = [1, 3, 7, 15, 30].map((d) => `<option value="${d}" ${d === 7 ? 'selected' : ''}>${d} dia${d > 1 ? 's' : ''}</option>`).join('');
    if (!m.stay) {
      html += `<label class="pequeno moradia-dias">Por <select class="campo" data-dias aria-label="Dias">${dias}</select></label>
        <div class="linha moradia-opcoes"><button class="btn btn--ghost pequeno" type="button" data-s="moradia" data-k="aluguel" data-l="1" ${off}>Aluguel · ${thaler(p.aluguel.cents_per_day)}/dia</button>
        ${p.hotel
          .map((h) => `<button class="btn btn--ghost pequeno" type="button" data-s="moradia" data-k="hotel" data-l="${h.level}" ${off}>Hotel ${h.level} · ${thaler(h.cents_per_day)}/dia</button>`)
          .join('')}</div>
        <p class="muted pequeno">O hotel inclui 1, 2 ou 3 refeições por dia, pelo nível. Valores provisórios.</p>`;
      // Hotéis de jogador: a diária do nível vai para o dono. Os cheios e fechados ficam de fora.
      const livres = hoteisJogador.filter((h) => !h.mine && h.open && h.guests < h.rooms).slice(0, 6);
      if (livres.length) {
        html += `<p class="pequeno">Hotéis de jogadores:</p><div class="linha moradia-opcoes">${livres
          .map(
            (h) =>
              `<button class="btn btn--ghost pequeno" type="button" data-s="moradia" data-k="hotel" data-l="${h.level}" data-hotel="${h.id}" ${off} title="${h.meals_per_day} refeição(ões) por dia">${esc(h.lot_code)} · nível ${h.level} · ${thaler(h.cents_per_day)}/dia · ${h.guests}/${h.rooms} quartos</button>`,
          )
          .join('')}</div>`;
      }
    } else {
      html += `<label class="pequeno moradia-dias">Mais dias: <select class="campo" data-dias aria-label="Dias">${dias}</select></label>`;
    }
    // Os hotéis da conta: a lotação (a diária dos hóspedes é a renda, 90% para o dono).
    const meus = hoteisJogador.filter((h) => h.mine);
    if (meus.length) {
      html += `<p class="muted pequeno">Seus hotéis: ${meus
        .map((h) => `${esc(h.lot_code)} · nível ${h.level} · ${h.guests}/${h.rooms} hóspedes${h.open ? '' : ' · fechado'}`)
        .join(' · ')}. Você recebe 90% das diárias.</p>`;
    }
    return html;
  };

  /**
   * Veículos (E3.5): autoescola, agência (compra, aluguel e recompra) e IPVA.
   * O carro existe só no jogo por enquanto; as corridas vêm depois.
   */
  const carSection = (a) => {
    const r = carCatalog.rules;
    const off = busy ? 'disabled' : '';
    const day = (iso) => new Date(iso).toLocaleDateString('pt-BR');
    let html = '<h3>🚗 Veículos</h3>';
    if (!a.license) {
      html += `<div class="linha"><button class="btn btn--ghost pequeno" type="button" data-s="autoescola" ${off}>Autoescola · ${thaler(r.license_price)}</button>
        <span class="muted pequeno">${r.license_hours} h sem trabalhar; habilita o avatar a dirigir.</span></div>`;
    } else if (!a.license.licensed) {
      html += `<p class="muted pequeno">Na autoescola: falta ${left(a.license.ready_at)}.</p>`;
    } else {
      html += '<p class="muted pequeno">🪪 Habilitado para dirigir.</p>';
    }
    const label = {
      ok: 'em dia',
      suspended: 'suspenso: IPVA atrasado',
      worn_out: 'gasto (só vende)',
      expired: 'aluguel vencido',
      pending: 'processando',
      broken: 'com pane',
      repairing: 'na oficina',
    };
    const rc = carCatalog.races;
    const priceOf = (c) => BigInt(carCatalog.models.find((m) => m.code === c.model)?.price ?? '0');
    const pct = (c, share) => ((priceOf(c) * BigInt(Math.round(share * 10_000))) / 10_000n).toString();
    const canRace = a.license?.licensed && a.status.canLeisure;
    if (cars.length) {
      html += `<ul class="lista-saques">${cars
        .map((c) => {
          const info = c.kind === 'rental' ? `alugado até ${day(c.rental_until)}` : `IPVA até ${day(c.ipva_paid_until)}`;
          const repair = c.breakdown ? rc.repairs.find((x) => x.code === c.breakdown) : null;
          const buttons = [
            c.state === 'ok'
              ? `<button class="btn btn--primary pequeno" type="button" data-s="correr" data-c="${esc(c.id)}" ${off || (canRace ? '' : 'disabled')} title="${canRace ? '' : 'Precisa de habilitação e 2 de energia'}">🏁 Correr · ${thaler(rc.fuel)}</button>`
              : '',
            c.state === 'broken' && repair
              ? `<button class="btn btn--blue pequeno" type="button" data-s="oficina" data-c="${esc(c.id)}" ${off}>Oficina · ${thaler(pct(c, repair.share))} (${repair.days} d)</button>`
              : '',
            c.state === 'ok' && !c.revision_until
              ? `<button class="btn btn--ghost pequeno" type="button" data-s="revisao" data-c="${esc(c.id)}" ${off}>Revisão · ${thaler(pct(c, rc.revision_share))}</button>`
              : '',
            c.ipva_payable ? `<button class="btn btn--blue pequeno" type="button" data-s="ipva" data-c="${esc(c.id)}" ${off}>IPVA · ${thaler(c.ipva_cents)}</button>` : '',
            c.buyback_cents !== null && c.state !== 'suspended' ? `<button class="btn btn--ghost pequeno" type="button" data-s="vender-carro" data-c="${esc(c.id)}" data-v="${esc(c.buyback_cents)}" ${off}>Vender · ${thaler(c.buyback_cents)}</button>` : '',
          ].join('');
          const extra = [
            c.breakdown && c.state === 'broken' ? `pane ${esc(c.breakdown)}` : '',
            c.repair_until ? `pronto em ${left(c.repair_until)}` : '',
            c.revision_until ? `revisão até ${day(c.revision_until)}` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return `<li><span>${esc(c.label)} · vel. ${c.attributes.speed} · força ${c.attributes.power} · ${esc(label[c.state] ?? c.state)} · ${info}${extra ? ` · ${extra}` : ''}</span><span class="linha">${buttons}</span></li>`;
        })
        .join('')}</ul>`;
    }
    const options = carCatalog.models
      .map((m) => `<option value="${esc(m.code)}">${esc(m.label)} · ${thaler(m.price)} (aluguel ${thaler(m.rent_price)}) · vel. ${m.speed}, força ${m.power}</option>`)
      .join('');
    html += `<form data-form="carro" class="comer">
        <div class="linha"><select class="campo" name="model" aria-label="Modelo">${options}</select></div>
        <div class="linha"><button class="btn btn--blue pequeno" type="submit" name="acao" value="comprar" ${off}>Comprar</button>
        <button class="btn btn--ghost pequeno" type="submit" name="acao" value="alugar" ${off}>Alugar ${r.rent_days} dias</button></div>
        <p class="muted pequeno">Corrida: até ${rc.per_day} por dia com ${rc.rivals} rivais; prêmios de ${rc.prizes.map(thaler).join(' / ')} para os 3 primeiros. A revisão reduz as panes por ${rc.revision_days} dias.</p>
        <p class="muted pequeno">Atributos no máximo por ${r.full_days} dias, depois caem até a metade em ${r.life_days}. IPVA de ${Math.round(r.ipva_share * 100)}% a cada ${r.ipva_days} dias; atrasado, suspende. A agência recompra por ${Math.round(r.buyback_share * 100)}% do valor depreciado. Preços provisórios.</p>
      </form>`;
    return html;
  };

  /**
   * Campeonato mensal de futebol de botão (E3.3): times de 6, inscrição paga;
   * na virada do mês o servidor disputa com a semente publicada e paga os 3 primeiros.
   */
  const cupSection = (a) => {
    const c = cup.championship;
    const r = cup.rules;
    const month = new Date(`${c.id}-01T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    let html = `<h3>⚽ Campeonato de botão <span class="muted pequeno">· ${esc(month)}</span></h3>
      <p class="muted pequeno">Inscrição de ${thaler(r.entry)} por jogador, times de ${r.team_size}. Prêmio: ${Math.round(r.prize_share * 100)}% do bolo para os 3 primeiros (${r.prizes.map((x) => `${Math.round(x * 100)}%`).join(' / ')}). Bolo de ${thaler(c.pool)}; disputa em ${left(c.ends_at)}.</p>`;
    const mine = c.teams.find((t) => t.mine);
    if (mine) {
      html += `<p class="muted pequeno">Você joga no <strong>${esc(mine.name)}</strong> (${mine.players}/${c.team_size})${c.me.status === 'pending' ? ' · inscrição processando' : ''}.</p>`;
    }
    if (c.teams.length) {
      html += `<ul class="lista-saques">${c.teams
        .map(
          (t) => `<li><span>${esc(t.name)} · ${t.players}/${c.team_size}</span>
            ${!c.me && !t.full ? `<button class="btn btn--ghost pequeno" type="button" data-s="time-entrar" data-t="${esc(t.id)}" ${busy ? 'disabled' : ''}>Entrar · ${thaler(r.entry)}</button>` : t.full ? '<span class="muted pequeno">completo</span>' : ''}</li>`,
        )
        .join('')}</ul>`;
    }
    if (!c.me) {
      html += `<form data-form="time" class="comer"><div class="linha">
          <input class="campo" name="name" required minlength="2" maxlength="30" placeholder="Nome do time" aria-label="Nome do time" />
          <button class="btn btn--blue" type="submit" ${busy ? 'disabled' : ''}>Criar time · ${thaler(r.entry)}</button></div></form>`;
    }
    html += `<p class="muted pequeno">Sorteio auditável: <code>${c.seed_commit.slice(0, 16)}…</code>. Time incompleto recebe a inscrição de volta; com menos de ${r.min_teams} times completos, todos recebem.</p>`;
    const last = cup.last;
    if (last?.result) {
      const res = last.result;
      const podium = res.ranking.filter((x) => x.complete).slice(0, 3);
      html += res.played
        ? `<p class="muted pequeno">Mês passado: ${podium.map((x, i) => `${['🥇', '🥈', '🥉'][i]} ${esc(x.name)}`).join(' · ')}.</p>`
        : '<p class="muted pequeno">Mês passado: sem times suficientes, as inscrições voltaram.</p>';
    }
    return html;
  };

  /**
   * Lazer (E3.3): parque de graça; academias e galerias são negócios de outros
   * jogadores, com entrada. Cada atividade uma vez a cada 4 h.
   */
  const leisureSection = (a) => {
    const wait = (code) => a.leisure[code];
    const can = a.status.canLeisure;
    const label = (code) => leisure.activities.find((x) => x.code === code)?.label ?? code;
    const btn = (code, text, extra = '') => {
      const until = wait(code);
      const off = busy || !can || until ? 'disabled' : '';
      return `<button class="btn btn--ghost pequeno" type="button" data-s="lazer" data-act="${code}" ${extra} ${off} title="${until ? `De novo em ${left(until)}` : esc(label(code))}">${text}</button>`;
    };
    let html = `<h3>🌳 Lazer</h3><div class="linha">${btn('skate', '🛹 Skate')}${btn('basquete', '🏀 Basquete')}</div>`;
    if (!can) html += '<p class="muted pequeno">Lazer precisa de 2 de energia.</p>';
    const open = venues.filter((v) => v.open).slice(0, 6);
    if (open.length && leisure.venues_on) {
      html += `<ul class="lista-saques">${open
        .map((v) => {
          const verb = v.activity === 'academia' ? 'Treinar' : 'Visitar';
          const price = v.mine ? 'sua, de graça' : thaler(v.fee_cents);
          return `<li><span>${v.activity === 'academia' ? '🏋️' : '🖼️'} ${esc(v.label)} · ${esc(v.lot_code)} · ${price}</span>
            ${btn(v.activity, verb, `data-v="${esc(v.id)}"`)}</li>`;
        })
        .join('')}</ul>`;
    } else {
      html += '<p class="muted pequeno">Nenhuma academia ou galeria aberta ainda. Num lote comercial ou misto seu, construa uma pela ficha do lote.</p>';
    }
    const waiting = leisure.activities.filter((x) => wait(x.code));
    if (waiting.length) html += `<p class="muted pequeno">${waiting.map((x) => `${esc(x.label)}: de novo em ${left(wait(x.code))}`).join(' · ')}</p>`;
    return html;
  };

  /**
   * Escola (E3.2): aula do dia (+educação) e troca de profissão (4 dias sem
   * trabalhar, só na mesma raridade). A educação nunca se perde.
   */
  const schoolSection = (a) => {
    const sc = a.school;
    const ed = a.attributes.education;
    let html = `<h3>🎓 Escola <span class="muted pequeno">· grau ${sc.grade}${sc.next_grade_at ? ` · próximo em ${sc.next_grade_at}` : ''} · turno ×${(1 + ed / 50).toLocaleString('pt-BR')}</span></h3>`;
    if (sc.changing_to) {
      return `${html}<p class="muted pequeno">Na escola para virar <strong>${esc(sc.changing_to.label)}</strong>: falta ${left(sc.changing_to.ends_at)}. Até lá, sem trabalho e sem aula.</p>`;
    }
    const off = busy ? 'disabled' : '';
    html += `<div class="linha">
        <button class="btn btn--blue pequeno" type="button" data-s="aula" ${off || (sc.class_today || ed >= 100 || a.attributes.energy < 2 ? 'disabled' : '')}>Aula · ${thaler(school.class.price)}</button>
        <span class="muted pequeno">${ed >= 100 ? 'Educação no máximo.' : sc.class_today ? 'Aula de hoje feita.' : `+${school.class.education} de educação, ${String(school.class.energy).replace('-', '−')} de energia. Uma por dia.`}</span>
      </div>`;
    const options = jobs
      .filter((j) => j.rarity === a.rarity && j.code !== a.job.code)
      .map((j) => `<option value="${esc(j.code)}">${esc(j.label)} · ${j.thaler_per_day} THALER/dia</option>`)
      .join('');
    if (options) {
      html += `<form data-form="trocar" class="comer">
          <div class="linha"><select class="campo" name="job" aria-label="Nova profissão">${options}</select>
          <button class="btn btn--ghost" type="submit" ${off}>Trocar · ${thaler(school.change.price)}</button></div>
          <p class="muted pequeno">${school.change.days} dias de escola sem trabalhar, com mais felicidade nos 2 primeiros. A educação continua.</p>
        </form>`;
    }
    return html;
  };

  /**
   * Pet do avatar (E3.1): adoção no Pet Shop, os atributos de 0 a 5, o nível
   * (multiplica a experiência no turno) e os cuidados. Quem decide é o game-core.
   */
  const petSection = (a) => {
    const pet = a.pet;
    const price = (code) => thaler(petshop.services.find((x) => x.code === code)?.price ?? '0');
    if (!pet) {
      const options = petshop.species.map((sp) => `<option value="${esc(sp.code)}">${esc(sp.label)} · ${thaler(sp.price)}</option>`).join('');
      return `<h3>🐾 Pet Shop</h3>
        <form data-form="adotar" class="comer">
          <div class="linha"><select class="campo" name="species" aria-label="Espécie">${options}</select>
          <input class="campo" name="name" required maxlength="24" placeholder="Nome" aria-label="Nome do pet" />
          <button class="btn btn--blue" type="submit" ${busy ? 'disabled' : ''}>Adotar</button></div>
          <p class="muted pequeno">Um pet por avatar. O nível dele multiplica a experiência no turno (até 1,25×). Sem comida, ele morre; triste, o avatar rende com metade da felicidade.</p>
        </form>`;
    }
    const icon = pet.species === 'cat' ? '🐱' : '🐶';
    if (!pet.alive) {
      return `<h3>${icon} ${esc(pet.name)} morreu</h3>
        <p class="muted pequeno">Ficou sem comida. Enterre para adotar outro.</p>
        <button class="btn btn--ghost pequeno" type="button" data-s="pet" data-a="enterrar" ${busy ? 'disabled' : ''}>Enterrar</button>`;
    }
    const at = pet.attributes;
    const hotel = pet.hotel_until;
    const next = pet.next_level_xp === null ? 'nível máximo' : `${pet.xp}/${pet.next_level_xp} de experiência para o próximo`;
    let html = `<h3>${icon} ${esc(pet.name)} <span class="muted pequeno">· ${esc(pet.species_label)} · nível ${pet.level} · ×${pet.multiplier.toLocaleString('pt-BR')}</span></h3>
      ${bar('Alimentação', at.food, 5)}${bar('Água', at.water, 5)}${bar('Felicidade', at.happiness, 5)}
      <p class="muted pequeno">${next}${pet.sad ? ' · <strong>triste: o avatar rende com metade da felicidade</strong>' : ''}</p>`;
    if (hotel) {
      const withSitter = sitters?.stay ? ' com um Pet Sitter' : ' no hotel';
      return `${html}<p class="muted pequeno">🏨 ${esc(pet.name)} está${withSitter} por mais ${left(hotel)}: não perde alimentação nem felicidade.</p>`;
    }
    const off = busy ? 'disabled' : '';
    html += `<div class="linha">
        <button class="btn btn--blue pequeno" type="button" data-s="pet-shop" data-v="racao" ${off || (at.food >= 5 ? 'disabled' : '')}>Ração · ${price('racao')}</button>
        <button class="btn btn--ghost pequeno" type="button" data-s="pet" data-a="agua" ${off || (at.water >= 5 ? 'disabled' : '')}>Água</button>
        <button class="btn btn--ghost pequeno" type="button" data-s="pet" data-a="passeio" ${off || (at.water <= 1 || !a.status.canLeisure || a.attributes.energy < 5 ? 'disabled' : '')}>Passear</button>
      </div>
      <div class="linha">
        <button class="btn btn--ghost pequeno" type="button" data-s="pet-shop" data-v="banho" ${off}>Banho · ${price('banho')}</button>
        <button class="btn btn--ghost pequeno" type="button" data-s="pet-shop" data-v="tosa" ${off}>Tosa · ${price('tosa')}</button>
        <button class="btn btn--ghost pequeno" type="button" data-s="pet-shop" data-v="hotel" ${off}>Hotel 24 h · ${price('hotel')}</button>
      </div>
      <p class="muted pequeno">Passear gasta 5 de energia do avatar e dá felicidade e saúde; o pet só bebe em casa. Preços provisórios.</p>`;
    // Pet Sitter de outro jogador: o mesmo cuidado do hotel, pago a ele.
    const list = (sitters?.sitters ?? []).filter((x) => x.slots > 0).slice(0, 3);
    if (list.length) {
      html += `<p class="pequeno"><strong>Pet Sitters da cidade</strong> (24 h, como o hotel; 90% vão para o sitter):</p><div class="linha">${list
        .map((x, i) => `<button class="btn btn--ghost pequeno" type="button" data-s="pet-sitter" data-id="${esc(x.avatar_id)}" ${off}>Sitter ${i + 1} · ${thaler(x.price)} · ${x.slots} vaga${x.slots > 1 ? 's' : ''}</button>`)
        .join('')}</div>`;
    }
    return html;
  };

  /** Painel do avatar Pet Sitter (E3.1): a oferta, os pets sob cuidado e o bônus do turno. */
  const sitterSection = () => {
    if (!sitters) return '';
    const o = sitterPanel?.offer;
    const off = busy ? 'disabled' : '';
    const price = o ? (Number(o.price) / 100).toString().replace('.', ',') : '20';
    let html = `<h3>🐕 Pet Sitter</h3>
      <p class="muted pequeno">Cuide do pet de outros jogadores por 24 h: você recebe 90% da diária e, com algum pet sob cuidado, o seu turno rende +20%. Até ${sitters.capacity} pets por vez.</p>`;
    if (sitterPanel?.caring?.length) {
      html += `<p class="pequeno"><span class="tag tag--srv">+20% no turno</span> Cuidando de ${sitterPanel.caring.length} pet${sitterPanel.caring.length > 1 ? 's' : ''}; o primeiro vai embora em ${left(sitterPanel.caring[0].ends_at)}.</p>`;
    }
    html += `<form data-form="sitter" class="banco">
        <div class="linha"><input class="campo" name="valor" inputmode="decimal" required value="${price}" aria-label="Diária em THALER" />
        <button class="btn btn--blue pequeno" type="submit" name="open" value="1" ${off}>${o?.open ? 'Mudar a diária' : 'Atender'}</button>
        ${o?.open ? `<button class="btn btn--ghost pequeno" type="submit" name="open" value="0" ${off}>Parar de atender</button>` : ''}</div>
        <p class="muted pequeno">Diária de ${thaler(sitters.price_min)} a ${thaler(sitters.price_max)} THALER.${o?.open ? ` Atendendo por ${thaler(o.price)}, ${o.slots} vaga${o.slots === 1 ? '' : 's'}.` : ' Fechado.'}</p>
      </form>`;
    return html;
  };

  const bar = (label, value, max = 10) =>
    `<div class="attr"><span>${label}</span><div class="barra"><span style="width:${(value / max) * 100}%"></span></div><b>${value}</b></div>`;

  function render() {
    if (!open) {
      panel.innerHTML = '<button class="btn btn--ghost" type="button" data-s="abrir">🎮 Jogo no servidor</button>';
      return;
    }
    const head = `<div class="linha cab"><h2>🎮 Jogo no servidor</h2><button class="btn btn--ghost" type="button" data-s="fechar" aria-label="Fechar o painel do jogo">–</button></div>`;
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
      // Limite da despensa pela casa: sem moradia 10, com moradia 30, com geladeira 60.
      const limite = pantryLimits
        ? moradia?.factor !== 1
          ? pantryLimits.unhoused
          : (a.gear?.home ?? []).includes('geladeira')
            ? pantryLimits.fridge
            : pantryLimits.housed
        : null;
      const unidades = guardados.reduce((n, p) => n + p.units, 0);
      if (!internado && guardados.length) {
        body += `<h3>🧺 Despensa${limite ? ` <span class="muted pequeno">· ${unidades}/${limite} unidades</span>` : ''}</h3><div class="linha">${guardados
          .map((p) => {
            const f = foods.find((x) => x.code === p.food);
            return `<button class="btn btn--ghost pequeno" type="button" data-s="consumir" data-f="${esc(p.food)}" ${busy || at.food >= 10 ? 'disabled' : ''}>${esc(f?.label ?? p.food)} × ${p.units}</button>`;
          })
          .join('')}</div>${
          // Com fogão ou micro-ondas, cozinha em casa: rende mais e sem dor de barriga.
          a.gear?.cooks_with
            ? `<div class="linha moradia-opcoes">${guardados
                .map((p) => {
                  const f = foods.find((x) => x.code === p.food);
                  return `<button class="btn btn--blue pequeno" type="button" data-s="cozinhar" data-f="${esc(p.food)}" ${busy || at.food >= 10 ? 'disabled' : ''}>🍳 Cozinhar ${esc(f?.label ?? p.food)}</button>`;
                })
                .join('')}</div>`
            : ''
        }${at.food >= 10 ? '<p class="muted pequeno">Satisfeito: come da despensa quando a alimentação baixar.</p>' : ''}`;
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
      if (moradia) body += housingSection(a);
      if (rotina && !internado) body += routineSection(a);
      if (loja && !internado && a.gear) body += shopSection(a);
      if (events) body += eventSection(a);
      if (!internado && leisure && a.leisure) body += leisureSection(a);
      if (cup) body += cupSection(a);
      if (carCatalog && cars) body += carSection(a);
      if (farm) body += farmSection(a);
      if (!internado && school && a.school) body += schoolSection(a);
      if (!internado && petshop) body += petSection(a);
      if (a.job?.code === 'pet_sitter') body += sitterSection();
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
        // Deslocamento (GDD §3.3): o modo atrasa o começo do ganho e pode custar (sai do pagamento).
        if (rotina) {
          // Skate só com o item da loja (com viagens); sem ele, volta para a pé.
          const semSkate = (a.gear?.skate_trips ?? 0) === 0;
          if (semSkate && commuteMode === 'skate') commuteMode = 'a_pe';
          const opts = rotina.commutes
            .map(
              (c) =>
                `<option value="${esc(c.mode)}" ${c.mode === commuteMode ? 'selected' : ''} ${c.needs_skate && semSkate ? 'disabled' : ''}>${esc(c.label)} · ${c.delay_min} min${c.cost !== '0' ? ` · ${thaler(c.cost)}` : ''}${
                  c.needs_skate ? (semSkate ? ' · compre na loja' : ` · ${a.gear.skate_trips} viagens`) : ''
                }</option>`,
            )
            .join('');
          body += `<label class="pequeno moradia-dias">Ir ao trabalho: <select class="campo" data-deslocamento aria-label="Como ir ao trabalho">${opts}</select></label>`;
        }
        if (a.rest) body += `<p class="muted pequeno">😴 Dormindo: acorda em ${left(a.rest.ends_at)} com +${a.rest.energy} de energia.</p>`;
        // A compra no mercado leva 4 min + volume: até lá, sem turno.
        if (a.market_until) body += `<p class="muted pequeno">🛒 No mercado: volta em ${left(a.market_until)}.</p>`;
        else if (a.status.mustRest) body += `<p class="pequeno">😴 Acordado há 16 h ou mais: durma (Descanso e higiene) para voltar a trabalhar.</p>`;
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

  // O modo de ir ao trabalho fica guardado: o painel redesenha e o select volta ao escolhido.
  panel.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-deslocamento]');
    if (!sel) return;
    commuteMode = sel.value;
    try {
      localStorage.setItem('scc-deslocamento', commuteMode);
    } catch {
      /* armazenamento indisponível */
    }
  });

  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target.closest('form[data-form]');
    if (!form || busy) return;
    const field = new FormData(form);
    if (form.dataset.form === 'carro') {
      const model = String(field.get('model') ?? '');
      const rent = e.submitter?.value === 'alugar';
      const m = carCatalog?.models.find((x) => x.code === model);
      return act(async () => {
        const r = await call(API.game, '/v1/vehicles', { method: 'POST', token: session.token, body: { model, rent } });
        message = rent
          ? `${m?.label ?? model} alugado até ${new Date(r.vehicle.rental_until).toLocaleDateString('pt-BR')}: −${thaler(m?.rent_price ?? '0')} THALER.`
          : `${m?.label ?? model} comprado: −${thaler(m?.price ?? '0')} THALER.`;
        messageOk = true;
      });
    }
    if (form.dataset.form === 'time') {
      const name = String(field.get('name') ?? '').trim();
      return act(async () => {
        await call(API.game, '/v1/championships/current/teams', { method: 'POST', token: session.token, body: { name, avatar_id: data.avatar.id } });
        message = `Time ${name} criado: −${thaler(cup?.rules.entry ?? '0')} THALER. Chame mais 5 jogadores.`;
        messageOk = true;
      });
    }
    if (form.dataset.form === 'trocar') {
      const job = String(field.get('job') ?? '');
      const label = jobs.find((j) => j.code === job)?.label ?? job;
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/school/change`, {
          method: 'POST',
          token: session.token,
          body: { job },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        message = `Matrícula para ${label}: −${thaler(r.purchase.price)} THALER. Volta a trabalhar em ${left(r.avatar.school.changing_to.ends_at)}.`;
        messageOk = true;
      });
    }
    if (form.dataset.form === 'adotar') {
      const species = String(field.get('species') ?? '');
      const name = String(field.get('name') ?? '').trim();
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/pet`, {
          method: 'POST',
          token: session.token,
          body: { species, name },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        message = `${r.avatar.pet.name} chegou: −${thaler(r.purchase.price)} THALER.`;
        messageOk = true;
      });
    }
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
    if (form.dataset.form === 'deposito') {
      const amount = toUnits(field.get('valor'), 18);
      const wallet = (me?.wallets ?? [])[0] ?? session.address;
      if (!amount || !wallet) {
        message = 'Valor inválido.';
        return render();
      }
      return act(async () => {
        const hash = await depositScity(amount, wallet).catch((error) => {
          throw vaultError(error);
        });
        message = `Depósito de ${scity(amount)} SCITY enviado (${short(hash)}). Vira saldo no jogo depois das confirmações.`;
        messageOk = true;
      });
    }
    if (form.dataset.form === 'sitter') {
      const cents = toUnits(field.get('valor'), 2);
      const open = e.submitter?.value !== '0';
      if (cents === null) {
        message = 'Valor inválido.';
        return render();
      }
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/pet-sitter`, {
          method: 'PUT',
          token: session.token,
          body: { open, price: cents.toString() },
        });
        message = r.offer.open ? `Atendendo como Pet Sitter por ${thaler(r.offer.price)} THALER a diária.` : 'Você parou de atender como Pet Sitter.';
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
        message = `Saque de ${scity(r.withdrawal.amount_wei)} SCITY pronto. ${hasWallet() ? 'Clique em Resgatar.' : 'Resgate com a carteira.'}`;
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
      // O painel é uma cortina lateral (cortinas.js): recolher fecha a cortina, e a aba na borda reabre.
      document.dispatchEvent(new CustomEvent('cortina', { detail: { name: 'jogo', open: what === 'abrir' } }));
      return;
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
        const hash = await claimVoucher(w).catch((error) => {
          throw vaultError(error);
        });
        message = `Resgatado (${short(hash)}): o SCITY está na carteira. O jogo marca como resgatado em até 1 min.`;
        messageOk = true;
      });
    }
    if (what === 'desistir') {
      const w = data.withdrawals?.withdrawals.find((x) => x.id === b.dataset.w);
      if (!w?.voucher) return;
      return act(async () => {
        const hash = await cancelVoucher(w).catch((error) => {
          throw vaultError(error);
        });
        message = `Voucher cancelado (${short(hash)}). O SCITY volta ao jogo em até 1 min.`;
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
        call(API.game, `/v1/avatars/${data.avatar.id}/work`, {
          method: 'POST',
          token: session.token,
          body: { shift: Number(b.dataset.h), commute: panel.querySelector('[data-deslocamento]')?.value ?? commuteMode },
        }),
      );
    }
    if (what === 'loja') {
      const item = b.dataset.i;
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/shop`, {
          method: 'POST',
          token: session.token,
          body: { item, ...(b.dataset.l ? { level: Number(b.dataset.l) } : {}) },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        const casa = loja.home?.find((i) => i.code === item);
        const label = casa?.label ?? { roupa: `Roupa nível ${b.dataset.l}`, ferramenta: 'Ferramenta de trabalho', cama: 'Cama', skate: 'Skate' }[item];
        message = item === 'skate'
          ? `Skate: −${thaler(r.purchase.price)} THALER. Aguenta ${r.avatar.gear.skate_trips} viagens: escolha Skate em Ir ao trabalho.`
          : casa
          ? `${label}: −${thaler(r.purchase.price)} THALER.${r.avatar.gear.complete_home ? ' Casa completa: +1 de felicidade ao acordar em casa.' : ''}`
          : `${label}: −${thaler(r.purchase.price)} THALER. Itens no turno: +${Math.round((r.avatar.gear.factor - 1) * 100)}%.`;
        messageOk = true;
      });
    }
    if (what === 'descansar') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/rest`, { method: 'POST', token: session.token, body: { hours: Number(b.dataset.h) } });
        message = `Dormindo ${b.dataset.h} h: acorda com +${r.avatar.rest.energy} de energia${r.housed ? '' : ' (sem moradia regular, metade)'}.`;
        messageOk = true;
      });
    }
    if (what === 'higiene') {
      return act(async () => {
        await call(API.game, `/v1/avatars/${data.avatar.id}/chores`, { method: 'POST', token: session.token, body: { code: b.dataset.c } });
        message = `${rotina.chores.find((c) => c.code === b.dataset.c)?.label ?? 'Feito'}: feito.`;
        messageOk = true;
      });
    }
    if (what === 'moradia') {
      const days = Number(panel.querySelector('[data-dias]')?.value ?? 7);
      const kind = b.dataset.k;
      const level = Number(b.dataset.l ?? 1);
      const hotelId = b.dataset.hotel;
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/housing`, {
          method: 'POST',
          token: session.token,
          body: { kind, level, days, ...(hotelId ? { hotel_id: hotelId } : {}) },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        moradia = r.housing;
        if (hotelId) hoteisJogador = await call(API.game, `/v1/housing/hotels?city=${CITY}`, { token: session.token }).then((x) => x.hotels).catch(() => hoteisJogador);
        message = `${kind === 'hotel' ? `${hotelId ? 'Hotel de jogador' : 'Hotel'} nível ${level}` : 'Aluguel'}: −${thaler(r.purchase.price)} THALER, até ${new Date(r.housing.stay.until).toLocaleDateString('pt-BR')}.`;
        messageOk = true;
      });
    }
    if (what === 'alugar-unidade') {
      const days = Number(panel.querySelector('[data-dias]')?.value ?? 7);
      return act(async () => {
        const r = await call(API.world, `/v1/world/units/${b.dataset.u}/lease`, {
          method: 'POST',
          token: session.token,
          body: { avatar_id: data.avatar.id, days },
        });
        message = `Apartamento ${r.unit.code} alugado até ${new Date(r.lease.ends_at).toLocaleDateString('pt-BR')}: −${thaler(r.lease.amount_cents)} THALER.`;
        messageOk = true;
      });
    }
    if (what === 'moradia-sair') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/housing`, { method: 'DELETE', token: session.token });
        moradia = r.housing;
        message = 'Saiu da moradia paga (sem reembolso).';
        messageOk = true;
      });
    }
    if (what === 'moradia-refeicao') {
      return act(async () => {
        await call(API.game, `/v1/avatars/${data.avatar.id}/housing/meal`, { method: 'POST', token: session.token });
        message = 'Refeição do hotel: +3 de alimentação, sem cobrança.';
        messageOk = true;
      });
    }
    if (what === 'autoescola') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/license`, {
          method: 'POST',
          token: session.token,
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        message = `Autoescola: −${thaler(r.purchase.price)} THALER. Habilitado em ${left(r.avatar.license.ready_at)}.`;
        messageOk = true;
      });
    }
    if (what && what.startsWith('fazenda-')) {
      const n = b.dataset.p;
      // Lê os campos antes do act(): ele redesenha o painel e os selects voltam ao padrão.
      const machine = panel.querySelector('[data-maquina]')?.value;
      const crop = panel.querySelector(`[data-crop="${n}"]`)?.value;
      const structure = panel.querySelector('[data-estrutura]')?.value;
      const breed = panel.querySelector('[data-raca]')?.value;
      const pair = [panel.querySelector('[data-par="0"]')?.value, panel.querySelector('[data-par="1"]')?.value];
      const id = b.dataset.id;
      const av = data.avatar?.id;
      const req = {
        'fazenda-comprar': () => call(API.game, '/v1/farm', { method: 'POST', token: session.token }),
        'fazenda-maquina': () => call(API.game, '/v1/farm/machines', { method: 'POST', token: session.token, body: { machine } }),
        'fazenda-arar': () =>
          call(API.game, `/v1/farm/plots/${n}/plow`, { method: 'POST', token: session.token, body: b.dataset.own ? { avatar_id: data.avatar.id } : {} }),
        'fazenda-plantar': () =>
          call(API.game, `/v1/farm/plots/${n}/plant`, { method: 'POST', token: session.token, body: { crop } }),
        'fazenda-colher': () => call(API.game, `/v1/farm/plots/${n}/harvest`, { method: 'POST', token: session.token, body: { avatar_id: data.avatar.id } }),
        'fazenda-nivel': () => call(API.game, '/v1/farm/level', { method: 'POST', token: session.token }),
        'fazenda-estrutura': () => call(API.game, '/v1/farm/structures', { method: 'POST', token: session.token, body: { structure } }),
        'fazenda-animal': () => call(API.game, '/v1/farm/animals', { method: 'POST', token: session.token, body: { breed } }),
        'fazenda-alimentar': () => call(API.game, `/v1/farm/animals/${id}/feed`, { method: 'POST', token: session.token, body: { avatar_id: av, food: b.dataset.f } }),
        'fazenda-abater': () => call(API.game, `/v1/farm/animals/${id}/slaughter`, { method: 'POST', token: session.token, body: { avatar_id: av } }),
        'fazenda-coletar': () => call(API.game, '/v1/farm/collect', { method: 'POST', token: session.token, body: { avatar_id: av } }),
        'fazenda-limpar': () => call(API.game, '/v1/farm/coop/clean', { method: 'POST', token: session.token }),
        'fazenda-chocar': () => call(API.game, '/v1/farm/hatch', { method: 'POST', token: session.token, body: { avatar_id: av } }),
        'fazenda-reproduzir': () => call(API.game, '/v1/farm/breed', { method: 'POST', token: session.token, body: { ids: pair, avatar_id: av, food: b.dataset.f } }),
      }[what];
      if (!req) return;
      return act(async () => {
        const r = await req();
        message = {
          'fazenda-comprar': 'Fazenda comprada: 4 canteiros esperando a enxada.',
          'fazenda-maquina': 'Máquina comprada.',
          'fazenda-arar': r.hired ? `Canteiro ${n} arado (contratado).` : `Canteiro ${n} arado pelo seu agricultor.`,
          'fazenda-plantar': `Canteiro ${n} plantado.`,
          'fazenda-colher': r.harvest ? `Colheita: ${r.harvest.units} un. de ${r.harvest.crop} na despensa${r.harvest.damage ? ` (${r.harvest.damage})` : ''}.` : '',
          'fazenda-nivel': `Fazenda no nível ${r.farm?.level}.`,
          'fazenda-estrutura': 'Estrutura construída.',
          'fazenda-animal': 'Animal comprado.',
          'fazenda-alimentar': 'Animal alimentado.',
          'fazenda-abater': r.meat ? `Abate: ${r.meat} carne(s) crua(s) na despensa.` : 'Abate de filhote: não deu carne.',
          'fazenda-coletar': r.collected ? `Coleta: ${r.collected.ovos} ovo(s) e ${r.collected.leite} leite(s) na despensa.` : '',
          'fazenda-limpar': 'Galinheiro limpo por 5 dias.',
          'fazenda-chocar': r.golden ? 'Nasceu uma galinha dos ovos de ouro!' : 'Nasceu um pinto.',
          'fazenda-reproduzir': `Nasceu um filhote (${r.baby}).`,
        }[what];
        messageOk = true;
      });
    }
    if (what === 'gamepass') {
      const level = Number(b.dataset.l);
      return act(async () => {
        const r = await call(API.game, '/v1/gamepass', { method: 'POST', token: session.token, body: { level } });
        message = `GamePass nível ${r.level}: −${scity(r.wei)} SCITY. Dano no turno −${Math.round(r.damage_cut * 100)}%${r.earn_bonus ? `, ganho +${Math.round(r.earn_bonus * 100)}%` : ''}.`;
        messageOk = true;
      });
    }
    if (what === 'correr') {
      return act(async () => {
        const r = await call(API.game, `/v1/vehicles/${b.dataset.c}/races`, { method: 'POST', token: session.token, body: { avatar_id: data.avatar.id } });
        const race = r.race;
        const prize = BigInt(race.prize) > 0n ? ` +${thaler(race.prize)} THALER.` : ' Sem prêmio.';
        message = `🏁 ${race.position}º lugar de ${race.of}.${prize} Gasolina ${thaler(race.fuel)}.${race.breakdown ? ` Pane ${race.breakdown}: leve à oficina.` : ''} Restam ${r.races_left_today} corridas hoje.`;
        messageOk = !race.breakdown;
      });
    }
    if (what === 'oficina') {
      return act(async () => {
        const r = await call(API.game, `/v1/vehicles/${b.dataset.c}/repair`, { method: 'POST', token: session.token });
        message = `Na oficina: −${thaler(r.cents)} THALER, pronto em ${left(r.vehicle.repair_until)}.`;
        messageOk = true;
      });
    }
    if (what === 'revisao') {
      return act(async () => {
        const r = await call(API.game, `/v1/vehicles/${b.dataset.c}/revision`, { method: 'POST', token: session.token });
        message = `Revisão feita: −${thaler(r.cents)} THALER, em dia até ${new Date(r.vehicle.revision_until).toLocaleDateString('pt-BR')}.`;
        messageOk = true;
      });
    }
    if (what === 'ipva') {
      return act(async () => {
        const r = await call(API.game, `/v1/vehicles/${b.dataset.c}/ipva`, { method: 'POST', token: session.token });
        message = `IPVA pago: ${r.vehicle.label} em dia até ${new Date(r.vehicle.ipva_paid_until).toLocaleDateString('pt-BR')}.`;
        messageOk = true;
      });
    }
    if (what === 'vender-carro') {
      return act(async () => {
        const r = await call(API.game, `/v1/vehicles/${b.dataset.c}/sell`, { method: 'POST', token: session.token });
        message = `Carro vendido para a agência: +${thaler(r.sold.cents)} THALER.`;
        messageOk = true;
      });
    }
    if (what === 'time-entrar') {
      const teamId = b.dataset.t;
      return act(async () => {
        const r = await call(API.game, `/v1/championships/current/teams/${teamId}/members`, {
          method: 'POST',
          token: session.token,
          body: { avatar_id: data.avatar.id },
        });
        const t = r.championship.teams.find((x) => x.mine);
        message = `Você entrou no ${t?.name ?? 'time'} (${t?.players ?? '?'}/${r.championship.team_size}).`;
        messageOk = true;
      });
    }
    if (what === 'lazer') {
      const activity = b.dataset.act;
      const venue_id = b.dataset.v;
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/leisure`, {
          method: 'POST',
          token: session.token,
          body: { activity, ...(venue_id ? { venue_id } : {}) },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        const name = leisure?.activities.find((x) => x.code === activity)?.label ?? activity;
        const at = r.avatar.attributes;
        message = `${name}${r.purchase && r.purchase.price !== '0' ? `: −${thaler(r.purchase.price)} THALER` : ''}. Felicidade ${at.happiness}/10, energia ${at.energy}/10.`;
        messageOk = true;
      });
    }
    if (what === 'aula') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/school/class`, {
          method: 'POST',
          token: session.token,
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        message = `Aula: −${thaler(r.purchase.price)} THALER, educação ${r.avatar.attributes.education}/100.`;
        messageOk = true;
      });
    }
    if (what === 'pet-shop') {
      const service = b.dataset.v;
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/pet/services`, {
          method: 'POST',
          token: session.token,
          body: { service },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        const label = petshop?.services.find((x) => x.code === service)?.label ?? service;
        message = `${label} para ${r.avatar.pet.name}: −${thaler(r.purchase.price)} THALER.`;
        messageOk = true;
      });
    }
    if (what === 'pet-sitter') {
      const sitterId = b.dataset.id;
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/pet/sitter`, {
          method: 'POST',
          token: session.token,
          body: { sitter_avatar_id: sitterId },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        message = `${r.avatar.pet.name} ficou com o Pet Sitter por 24 h: −${thaler(r.purchase.price)} THALER.`;
        messageOk = true;
      });
    }
    if (what === 'pet') {
      const action = b.dataset.a;
      return act(async () => {
        const name = data.avatar.pet?.name ?? 'o pet';
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/pet/actions`, { method: 'POST', token: session.token, body: { action } });
        message =
          action === 'enterrar'
            ? `${name} foi enterrado. O Pet Shop tem outros esperando.`
            : action === 'agua'
              ? `${name} bebeu água.`
              : `Passeio com ${name}: energia ${r.avatar.attributes.energy}/10, felicidade ${r.avatar.attributes.happiness}/10.`;
        messageOk = true;
      });
    }
    if (what === 'cozinhar') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/cook`, { method: 'POST', token: session.token, body: { food: b.dataset.f } });
        const label = foods.find((f) => f.code === b.dataset.f)?.label ?? b.dataset.f;
        message = `${label} feito em casa: alimentação ${r.avatar.attributes.food}/10, saúde ${r.avatar.attributes.health}/10.`;
        messageOk = true;
      });
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
        if (box.querySelector('[data-buy]')) showLaunch(i, box);
        if (lot.mine) showBuild(i, lot, box);
        if (lot.status === 'sold') showVisit(i, box);
        if (lot.status === 'sold') showUnits(i, box);
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
      // Unidades do prédio (E3.11).
      const unitAct = e.target.closest('[data-u-gerar], [data-u-buy], [data-u-lease], [data-u-offer]');
      if (unitAct && !unitAct.disabled) {
        const sec = unitAct.closest('[data-building]');
        try {
          if (unitAct.matches('[data-u-gerar]')) {
            const perFloor = Number(sec.querySelector('[data-u-por-andar]').value);
            const m2 = Math.round(Number(sec.querySelector('[data-u-m2]').value) * 100);
            const r = await call(API.world, `/v1/world/buildings/${sec.dataset.building}/units`, {
              method: 'POST',
              token: session.token,
              body: { units_per_floor: perFloor, ground_commercial: sec.querySelector('[data-u-terreo]').checked, price_cents_per_m2: m2 },
            });
            message = `${r.units.length} unidades à venda.`;
          } else if (unitAct.matches('[data-u-buy]')) {
            const r = await call(API.world, `/v1/world/units/${unitAct.dataset.uBuy}/buy`, { method: 'POST', token: session.token });
            message = `Unidade ${r.unit.code} é sua por ${thaler(r.sale.price_cents)} THALER.`;
          } else if (unitAct.matches('[data-u-lease]')) {
            const r = await call(API.world, `/v1/world/units/${unitAct.dataset.uLease}/lease`, {
              method: 'POST',
              token: session.token,
              body: { avatar_id: data.avatar.id, days: 7 },
            });
            message = `Alugada até ${new Date(r.lease.ends_at).toLocaleDateString('pt-BR')}: −${thaler(r.lease.amount_cents)} THALER. É a moradia do avatar.`;
          } else {
            // Preços do dono: em branco tira da venda ou do aluguel.
            const li = unitAct.closest('li');
            const toCents = (v) => (v && v.trim() ? Math.round(Number(v.replace(',', '.')) * 100) : null);
            await call(API.world, `/v1/world/units/${unitAct.dataset.uOffer}/offer`, {
              method: 'PUT',
              token: session.token,
              body: {
                price_cents: toCents(li.querySelector('[data-u-price]')?.value),
                ...(unitAct.dataset.kind === 'residencial' ? { rent_cents_per_day: toCents(li.querySelector('[data-u-rent]')?.value) } : {}),
              },
            });
            message = 'Preços da unidade salvos.';
          }
          messageOk = true;
        } catch (error) {
          message = error.message;
          messageOk = false;
        }
        await refresh();
        return map.showLot(i);
      }
      // Prefeitura e serviços do imóvel (regularizar, água, energia).
      const obra = e.target.closest('[data-obra]');
      if (obra && !obra.disabled) {
        const here = (await call(API.world, '/v1/world/me/properties', { token: session.token })).properties.find((p) => p.lot_id === i);
        obra.disabled = true;
        try {
          const r = await call(API.world, `/v1/world/properties/${here.id}/${obra.dataset.obra}`, { method: 'POST', token: session.token });
          const what = { regularize: 'Regularizado na Prefeitura', water: 'Água ligada', power: 'Energia ligada', upgrade: `Nível ${r.property.level}`, retype: `Agora é ${r.property.label}` }[obra.dataset.obra];
          message = `${what}: −${thaler(r.work.cost_cents)} THALER.${r.property.regular ? ' O imóvel rende 100%.' : ''}`;
          messageOk = true;
        } catch (error) {
          message = error.message;
          messageOk = false;
        }
        await refresh();
        return map.showLot(i);
      }
      const build = e.target.closest('[data-construir]');
      if (build && !build.disabled) {
        const type = box.querySelector('select[name=tipo]')?.value;
        build.disabled = true;
        build.textContent = 'Construindo…';
        try {
          const r = await call(API.world, `/v1/world/cities/${CITY}/lots/${i}/property`, { method: 'POST', token: session.token, body: { type } });
          message = `${r.property.label} em obra: fica pronta em ${left(r.property.ready_at)}.`;
          messageOk = true;
        } catch (error) {
          message = error.message;
          messageOk = false;
        }
        await refresh();
        return map.showLot(i);
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

  /**
   * Venda de lançamento (E4.3): com a cidade abrindo, a compra passa pela fila. Mostra a fase, a posição
   * (sorteada para quem entrou antes da abertura), a vez e o limite por carteira; o botão Comprar só vale na vez.
   */
  let launchTimer = null;
  async function showLaunch(i, box) {
    const v = await call(API.world, `/v1/world/cities/${CITY}/sale`, { token: session.token }).catch(() => null);
    const s = v?.sale;
    if (!s || s.phase === 'ended' || !box.isConnected) return;
    const t = v.me?.ticket ?? null;
    const myTurn = s.phase === 'launch' && t?.state === 'admitted';
    const full = v.me ? v.me.bought >= s.max_lots : false;
    const buy = box.querySelector('[data-buy]');
    if (buy && (!myTurn || full)) buy.disabled = true;
    const sec = document.createElement('div');
    sec.className = 'srv-fila';
    let html = '<h3>🎟️ Venda de lançamento</h3>';
    if (s.phase === 'soon') {
      html += `<p class="muted pequeno">A fila abre em ${left(s.queue_opens_at)}, e a venda, em ${left(s.opens_at)}.</p>`;
    } else if (full) {
      html += '<p><span class="tag">Limite atingido</span> Você já comprou o máximo do lançamento. Depois dele, a venda fica livre.</p>';
    } else if (!t || t.state === 'expired') {
      html += `<p class="muted pequeno">${t ? 'Sua vez passou. ' : ''}Para comprar, entre na fila${
        s.phase === 'queue' ? '. Quem entra antes da abertura tem a posição sorteada, sem vantagem para quem chega primeiro.' : '.'
      }</p><button class="btn btn--blue" type="button" data-fila>Entrar na fila</button>`;
    } else if (t.state === 'waiting') {
      html += `<p>Posição <strong>${t.position}</strong>${t.provisional ? ' (provisória: o sorteio fecha na abertura)' : ''}. Sua vez em ${left(t.admit_at)}.</p>`;
    } else {
      html += `<p><span class="tag tag--srv">Sua vez</span> Você tem ${left(t.expires_at)} para comprar.</p>`;
    }
    html += `<p class="muted pequeno">Até ${s.max_lots} lote${s.max_lots > 1 ? 's' : ''} por carteira no lançamento${
      v.me ? ` · você comprou ${v.me.bought}` : ''
    }. Entram ${s.batch_size} a cada ${s.batch_seconds} s.</p>`;
    sec.innerHTML = html;
    (buy?.parentElement === box ? buy : box.lastElementChild)?.after(sec);
    sec.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-fila]');
      if (!b) return;
      e.stopPropagation();
      b.disabled = true;
      b.textContent = 'Entrando…';
      try {
        await call(API.world, `/v1/world/cities/${CITY}/sale/queue`, { method: 'POST', token: session.token });
      } catch (error) {
        message = error.message;
        messageOk = false;
      }
      map.showLot(i);
    });
    // Esperando a vez (ou a abertura): reabre a ficha na hora certa, sem o jogador recarregar.
    clearTimeout(launchTimer);
    const next = s.phase === 'soon' ? s.queue_opens_at : t?.state === 'waiting' ? t.admit_at : myTurn ? t.expires_at : null;
    const wait = next ? new Date(next).getTime() - Date.now() + 500 : 0;
    if (wait > 0 && wait < 30 * 60_000) launchTimer = setTimeout(() => box.isConnected && map.showLot(i), wait);
  }

  /**
   * Prefeitura e serviços do imóvel pronto (doc 03 §3): regularizar uma vez, água e energia por 30 dias.
   * Sem as três, o imóvel rende 50%; a casa regular também é a moradia própria do avatar.
   */
  function regularBox(p) {
    const until = (iso) => (iso && new Date(iso) > new Date() ? `até ${new Date(iso).toLocaleDateString('pt-BR')}` : null);
    const row = (icon, label, status, action, cost) =>
      `<li>${icon} ${label}: <strong>${status ?? 'não'}</strong> <button class="btn btn--ghost pequeno" type="button" data-obra="${action}">${status ? 'Renovar' : 'Contratar'} · ${thaler(cost)}</button></li>`;
    // Nível e troca de tipo (T1 → T2 → T3): a troca pede o último nível e cobra a diferença de preço.
    const grow = [
      p.next_level ? `<button class="btn btn--ghost pequeno" type="button" data-obra="upgrade">Nível ${p.next_level.level} · ${thaler(p.next_level.cost_cents)}</button>` : '',
      p.next_type
        ? `<button class="btn btn--blue pequeno" type="button" data-obra="retype" ${p.next_type.ready ? '' : 'disabled'} title="${p.next_type.ready ? '' : 'Suba até o último nível antes'}">Trocar para ${esc(p.next_type.label)} · ${thaler(p.next_type.cost_cents)}</button>`
        : '',
    ].filter(Boolean).join('');
    const reg = p.regularized_at
      ? `<li>🏛️ Prefeitura: <strong>regularizado (${p.use})</strong></li>`
      : `<li>🏛️ Prefeitura: <strong>não</strong> <button class="btn btn--ghost pequeno" type="button" data-obra="regularize">Regularizar · ${thaler(p.regularization_cost_cents)}</button></li>`;
    const water = until(p.water_until);
    const power = until(p.power_until);
    return `${grow ? `<p class="muted pequeno">Nível ${p.level} · renda ${thaler(p.income_cents_per_day)}/dia</p><div class="linha moradia-opcoes">${grow}</div>` : ''}<ul class="srv-lista pequeno">${reg}
      ${row('💧', 'Água', water, 'water', p.utility_cost_cents?.water ?? 0)}
      ${row('⚡', 'Energia', power, 'power', p.utility_cost_cents?.power ?? 0)}</ul>
      <p class="muted pequeno">${p.regular ? '✅ Rende 100%.' : '⚠️ Rende 50% até regularizar e ligar água e energia.'} Serviços por 30 dias, mais caros longe do centro.</p>`;
  }

  /** Ficha do lote próprio: o imóvel que está nele ou, vazio, o que dá para construir na zona. */
  async function showBuild(i, lot, box) {
    const sec = document.createElement('div');
    sec.className = 'srv-obra';
    box.append(sec);
    const [types, mine] = await Promise.all([
      propertyTypes ?? call(API.world, '/v1/world/property-types').then((r) => (propertyTypes = r.types)).catch(() => null),
      call(API.world, '/v1/world/me/properties', { token: session.token }).then((r) => r.properties).catch(() => null),
    ]);
    if (!types || !mine) return sec.remove();
    const here = mine.find((p) => p.lot_id === i);
    if (here) {
      const t = types.find((x) => x.code === here.type);
      const state = here.phase === 'building' ? `em obra, pronta em ${left(here.ready_at)}` : here.phase === 'ready' ? `pronta · desgaste ${here.wear}` : 'aguardando pagamento';
      sec.innerHTML = `<h3>🏗️ ${esc(here.label)}</h3><p class="muted pequeno">${state}${t?.venue ? ` · entrada de ${thaler(t.venue.fee_cents)} (90% para você)` : ''}</p>${here.phase === 'ready' ? regularBox(here) : ''}`;
      return;
    }
    // Só o que se constrói direto: T2 e T3 vêm da troca de tipo; sem valores no catálogo, não aparece.
    const fits = types.filter((t) => t.zones.includes(lot.zone) && t.buildable !== false);
    if (!fits.length) return sec.remove();
    const options = fits.map((t) => `<option value="${esc(t.code)}">${esc(t.label)} · ${thaler(t.price_cents)}${t.venue ? ` · entrada ${thaler(t.venue.fee_cents)}` : ''}</option>`).join('');
    sec.innerHTML = `<h3>🏗️ Construir</h3>
      <div class="linha"><select class="campo" name="tipo" aria-label="O que construir">${options}</select>
      <button class="btn btn--blue pequeno" type="button" data-construir>Construir</button></div>
      <p class="muted pequeno">Obra de 1 dia, paga em THALER. Academia e galeria cobram entrada de quem usa.</p>`;
  }

  /**
   * Unidades do prédio aprovado no lote (E3.11): o construtor gera e põe à venda; quem compra revende ou
   * aluga para outro avatar morar. Preços em THALER.
   */
  async function showUnits(i, box) {
    const b = await call(API.world, `/v1/world/cities/${CITY}/lots/${i}/building`, { token: session.token })
      .then((r) => r.building)
      .catch(() => null);
    if (!b) return;
    const sec = document.createElement('div');
    sec.className = 'srv-obra srv-unidades';
    sec.dataset.building = b.id;
    box.append(sec);
    const units = await call(API.world, `/v1/world/buildings/${b.id}/units`, { token: session.token })
      .then((r) => r.units)
      .catch(() => null);
    if (units === null) return sec.remove();
    const mineBuilding = b.mine ?? false;
    if (!units.length) {
      sec.innerHTML = mineBuilding || lotsMine(i)
        ? `<h3>🏢 Unidades</h3><p class="muted pequeno">${b.floors} andares. Gere as unidades e elas vão à venda (95% para você, 5% de taxa).</p>
          <div class="linha moradia-opcoes"><label class="pequeno">Por andar <input class="campo" type="number" min="1" max="20" value="4" data-u-por-andar style="width:64px"></label>
          <label class="pequeno">THALER/m² <input class="campo" type="number" min="0.01" step="0.01" value="10" data-u-m2 style="width:80px"></label>
          <label class="pequeno"><input type="checkbox" data-u-terreo> Térreo comercial</label></div>
          <button class="btn btn--blue pequeno" type="button" data-u-gerar>Gerar unidades</button>`
        : '<h3>🏢 Unidades</h3><p class="muted pequeno">O construtor ainda não pôs as unidades à venda.</p>';
      return;
    }
    const shown = units.slice(0, 24);
    const row = (u) => {
      const tags = [
        u.kind === 'comercial' ? 'comercial' : '',
        u.rented_until ? `alugada até ${new Date(u.rented_until).toLocaleDateString('pt-BR')}` : '',
        u.mine ? 'sua' : '',
      ].filter(Boolean).join(' · ');
      const acts = [];
      if (!u.mine && u.price_cents !== null && !u.selling) acts.push(`<button class="btn btn--blue pequeno" type="button" data-u-buy="${u.id}">Comprar · ${thaler(u.price_cents)}</button>`);
      if (!u.mine && u.rent_cents_per_day !== null && (!u.rented_until || u.rented_by_me) && data.avatar)
        acts.push(`<button class="btn btn--ghost pequeno" type="button" data-u-lease="${u.id}">Alugar 7 dias · ${thaler(u.rent_cents_per_day * 7)}</button>`);
      if (u.mine)
        acts.push(`<input class="campo" type="number" min="0" step="0.01" placeholder="venda" data-u-price value="${u.price_cents !== null ? u.price_cents / 100 : ''}" style="width:84px" aria-label="Preço de venda em THALER">
          ${u.kind === 'residencial' ? `<input class="campo" type="number" min="0" step="0.01" placeholder="aluguel/dia" data-u-rent value="${u.rent_cents_per_day !== null ? u.rent_cents_per_day / 100 : ''}" style="width:84px" aria-label="Aluguel por dia em THALER">` : ''}
          <button class="btn btn--ghost pequeno" type="button" data-u-offer="${u.id}" data-kind="${u.kind}">Salvar</button>`);
      return `<li><strong>${esc(u.code)}</strong> · ${u.area_m2} m²${tags ? ` · <span class="muted">${tags}</span>` : ''}
        ${u.price_cents !== null ? ` · venda ${thaler(u.price_cents)}` : ''}${u.rent_cents_per_day !== null ? ` · aluguel ${thaler(u.rent_cents_per_day)}/dia` : ''}
        <div class="linha moradia-opcoes">${acts.join('')}</div></li>`;
    };
    sec.innerHTML = `<h3>🏢 Unidades (${units.length})</h3><ul class="srv-lista pequeno">${shown.map(row).join('')}</ul>
      ${units.length > shown.length ? `<p class="muted pequeno">E mais ${units.length - shown.length} unidades.</p>` : ''}
      <p class="muted pequeno">Revenda paga 2% ao construtor; o aluguel, 10% de taxa da Prefeitura. Valores provisórios.</p>`;
  }
  const lotsMine = (i) => (data.lots ?? []).some((l) => l.id === i);

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

  /** Compra de mercado vinda da cena (mercado-rua.js): o pacote vai para a despensa; a refeição é comida na hora. */
  async function buyFood(kind, food) {
    if (!session || !data.avatar) throw Object.assign(new Error('Entre no jogo e pegue um avatar para comprar.'), { code: 'no_session' });
    const path = kind === 'pack' ? 'pantry' : 'meals';
    const r = await call(API.game, `/v1/avatars/${data.avatar.id}/${path}`, {
      method: 'POST',
      token: session.token,
      body: { food },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    data.avatar = r.avatar;
    return r;
  }
  /**
   * Ação de compra do avatar vinda da cena (lojas-rua.js): `shop` (loja do jogo) ou `medicine` (farmácia).
   * Devolve a resposta do game-core e guarda o avatar novo.
   */
  async function avatarPost(path, body) {
    if (!session || !data.avatar) throw Object.assign(new Error('Entre no jogo e pegue um avatar para comprar.'), { code: 'no_session' });
    const r = await call(API.game, `/v1/avatars/${data.avatar.id}/${path}`, {
      method: 'POST',
      token: session.token,
      body,
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    if (r.avatar) data.avatar = r.avatar;
    return r;
  }
  let shopCat = null;
  let medicineCents = null;
  let routineCat = null;
  /** O catálogo da rotina (descanso, higiene, deslocamento e a passagem do ônibus), uma vez. */
  const routineCatalog = async () => (routineCat ??= await call(API.game, '/v1/catalog/routine'));
  /** O catálogo da loja do jogo (uma vez). */
  const shopCatalog = async () => (shopCat ??= await call(API.game, '/v1/catalog/shop'));
  call(API.game, '/v1/catalog/pharmacy')
    .then((r) => { medicineCents = Number(r.price); })
    .catch(() => {});
  /** O catálogo do mercado (carrega se ainda não veio). */
  async function foodCatalog() {
    if (!foods.length) foods = await call(API.game, '/v1/catalog/foods').then((r) => r.foods).catch(() => []);
    return foods;
  }

  return {
    refresh,
    decorateLot,
    visit,
    buyFood,
    foodCatalog,
    avatarPost,
    shopCatalog,
    routineCatalog,
    /** Os carros da conta (GET /v1/vehicles, do último refresh). */
    myCars: () => cars ?? [],
    medicinePrice: () => medicineCents,
    active: () => session !== null,
    getSession: () => session,
    getData: () => data,
    API,
  };
}
