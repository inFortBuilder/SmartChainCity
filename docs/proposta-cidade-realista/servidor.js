// Liga o mapa aos serviços (célula jogável, E1.6): o jogador entra com a
// carteira (SIWE, pelo gateway), vê o avatar (game-core) e o THALER do ledger
// (economy), trabalha um turno e coleta. Aqui nada é simulado: quem decide é o
// servidor (ADR-0002). A gestão de lotes e negócios do painel "Meu
// patrimônio" continua simulada no navegador até o serviço world.

const params = new URLSearchParams(location.search);
const API = {
  gateway: params.get('gateway') ?? 'http://127.0.0.1:8000',
  economy: params.get('economy') ?? 'http://127.0.0.1:8010',
  game: params.get('game') ?? 'http://127.0.0.1:8020',
};
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

const thaler = (cents) => (Number(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const left = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'concluindo…';
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(base, path, { method = 'GET', body, token } = {}) {
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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

/** Assina a mensagem SIWE com a MetaMask, ou com a carteira de teste guardada no navegador. */
async function signIn(useTestWallet) {
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
    statement: 'Entrar na Smart Chain City.',
  });
  const signature = await sign(message);
  const result = await call(API.gateway, '/v1/auth/siwe/verify', { method: 'POST', body: { message, signature } });
  return { token: result.access_token, address, expiresAt: Date.now() + result.expires_in * 1000 };
}

export function createServidor() {
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
  let data = { avatar: null, balance: '0', shifts: [] };
  let message = '';
  let messageOk = false;
  let busy = false;
  let open = true;

  const logout = (why = '') => {
    session = null;
    storage.set(TOKEN_KEY, null);
    data = { avatar: null, balance: '0', shifts: [] };
    message = why;
    render();
  };

  async function refresh() {
    if (!session) return render();
    try {
      const [avatars, balances] = await Promise.all([
        call(API.game, '/v1/avatars', { token: session.token }),
        call(API.economy, '/v1/economy/balances', { token: session.token }),
      ]);
      data.avatar = avatars.avatars[0] ?? null;
      data.balance = balances.balances.find((b) => b.currency === 'THALER')?.amount ?? '0';
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
        <p class="muted">Entre com a carteira para trabalhar e receber THALER de verdade, pelo servidor.</p>
        ${window.ethereum ? '<button class="btn btn--primary" type="button" data-s="entrar">Entrar com a carteira</button>' : ''}
        ${LOCAL ? '<button class="btn btn--blue" type="button" data-s="entrar-teste">Entrar com carteira de teste</button>' : ''}
        ${!window.ethereum && !LOCAL ? '<p class="muted">Instale uma carteira (MetaMask) para entrar.</p>' : ''}
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
      if (running) {
        const total = new Date(running.ends_at) - new Date(running.starts_at);
        const pct = Math.min(100, ((Date.now() - new Date(running.starts_at)) / total) * 100);
        body += `<h3>Trabalhando · turno de ${running.hours} h</h3>
          <div class="barra"><span style="width:${pct}%"></span></div>
          <p class="muted pequeno">Falta ${left(running.ends_at)}. Pode fechar o jogo: o servidor conclui o turno.<br>
          Compromisso do sorteio: <code>${running.seed_commit.slice(0, 16)}…</code></p>`;
      } else {
        body += `<div class="linha">
          <button class="btn btn--blue" type="button" data-s="work" data-h="6" ${busy || !a.status.canWork ? 'disabled' : ''}>Trabalhar 6 h</button>
          <button class="btn btn--blue" type="button" data-s="work" data-h="12" ${busy || !a.status.canWork ? 'disabled' : ''}>Trabalhar 12 h</button></div>`;
      }
      if (done.length) {
        const total = done.reduce((sum, s) => sum + BigInt(s.result.thaler), 0n);
        body += `<button class="btn btn--primary" type="button" data-s="claim" ${busy ? 'disabled' : ''}>Coletar ${thaler(total)} THALER</button>`;
      }
      if (last?.result) {
        body += `<p class="muted pequeno">Último turno: ${thaler(last.result.thaler)} THALER${last.result.damaged ? ' (com danos)' : ''} · semente revelada <code>${last.seed.slice(0, 12)}…</code></p>`;
      }
    }
    panel.innerHTML = `${head}
      <dl class="resumo"><dt>Conta</dt><dd>${short(session.address)}</dd><dt>THALER (ledger)</dt><dd>${thaler(data.balance)}</dd></dl>
      ${body}${note}
      <button class="btn btn--ghost pequeno" type="button" data-s="sair">Sair</button>`;
  }

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled) return;
    const what = b.dataset.s;
    if (what === 'fechar' || what === 'abrir') {
      open = what === 'abrir';
      return render();
    }
    if (what === 'sair') return logout();
    if (what === 'entrar' || what === 'entrar-teste') {
      return act(async () => {
        session = await signIn(what === 'entrar-teste');
        storage.set(TOKEN_KEY, JSON.stringify(session));
      });
    }
    if (what === 'avatar') return act(() => call(API.game, '/v1/dev/avatar', { method: 'POST', token: session.token }));
    if (what === 'work') {
      return act(() =>
        call(API.game, `/v1/avatars/${data.avatar.id}/work`, { method: 'POST', token: session.token, body: { shift: Number(b.dataset.h) } }),
      );
    }
    if (what === 'claim') {
      return act(async () => {
        const r = await call(API.game, `/v1/avatars/${data.avatar.id}/claim`, { method: 'POST', token: session.token });
        message = `+${thaler(r.thaler)} THALER coletados no ledger.`;
        messageOk = true;
      });
    }
  });

  render();
  refresh();
  // Atualiza o turno e o saldo enquanto a página está aberta.
  setInterval(() => {
    if (session && !busy && !document.hidden) refresh();
  }, 10_000);

  return { refresh, getSession: () => session, getData: () => data, API };
}
