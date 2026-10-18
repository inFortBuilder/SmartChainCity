/* Smart Chain City — integração com carteira (EIP-1193: MetaMask e compatíveis).
 * Sem bibliotecas externas: usa window.ethereum e chamadas JSON-RPC diretas.
 * Expõe window.SCC.wallet para as páginas (conta, marketplace, venda). */
(() => {
  'use strict';

  const cfg = (window.SCC && window.SCC.chain) || {};
  const STORAGE_KEY = 'scc.wallet.connected';
  const listeners = new Set();
  const state = { address: null, chainId: null };

  const hexChain = (id) => '0x' + Number(id).toString(16);
  const provider = () => window.ethereum || null;
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

  const store = (v) => { try { v ? localStorage.setItem(STORAGE_KEY, '1') : localStorage.removeItem(STORAGE_KEY); } catch { /* armazenamento indisponível */ } };
  const wasConnected = () => { try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; } };

  const emit = () => {
    listeners.forEach((fn) => fn({ ...state }));
    document.querySelectorAll('[data-wallet-balance]').forEach((el) => {
      el.textContent = state.address ? short(state.address) : 'Conectar';
    });
  };

  /** Formata um valor inteiro (BigInt, em unidades mínimas) com casas decimais. */
  const formatUnits = (value, decimals = 18, shown = 2) => {
    const neg = value < 0n; let v = neg ? -value : value;
    const base = 10n ** BigInt(decimals);
    const int = v / base;
    const frac = (v % base).toString().padStart(decimals, '0').slice(0, shown);
    const intStr = new Intl.NumberFormat('pt-BR').format(int);
    return (neg ? '-' : '') + intStr + (shown > 0 ? ',' + frac : '');
  };

  async function ensureChain() {
    const p = provider();
    if (!p || !cfg.chainId) return;
    const wanted = hexChain(cfg.chainId);
    const current = await p.request({ method: 'eth_chainId' });
    if (current === wanted) return;
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: wanted }] });
    } catch (err) {
      if (err && err.code === 4902) { // rede ainda não adicionada na carteira
        await p.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: wanted,
            chainName: cfg.chainName,
            nativeCurrency: { name: 'BNB', symbol: cfg.chainId === 56 ? 'BNB' : 'tBNB', decimals: 18 },
            rpcUrls: [cfg.rpcUrl],
            blockExplorerUrls: [cfg.explorer],
          }],
        });
      } else {
        throw err;
      }
    }
  }

  async function connect() {
    const p = provider();
    if (!p) {
      window.SCC.toast?.('Instale a MetaMask (ou outra carteira compatível) para continuar.', 4000);
      throw new Error('no_provider');
    }
    const [address] = await p.request({ method: 'eth_requestAccounts' });
    await ensureChain();
    state.address = address;
    state.chainId = parseInt(await p.request({ method: 'eth_chainId' }), 16);
    store(true);
    emit();
    return { ...state };
  }

  function disconnect() {
    state.address = null; state.chainId = null;
    store(false);
    emit();
  }

  async function bnbBalance() {
    if (!state.address) return null;
    const hex = await provider().request({ method: 'eth_getBalance', params: [state.address, 'latest'] });
    return formatUnits(BigInt(hex), 18, 4);
  }

  /** balanceOf(address) do token SCITY, via eth_call (seletor 0x70a08231). */
  async function tokenBalance() {
    if (!state.address || !cfg.tokenAddress) return null;
    const data = '0x70a08231' + state.address.toLowerCase().replace('0x', '').padStart(64, '0');
    const hex = await provider().request({ method: 'eth_call', params: [{ to: cfg.tokenAddress, data }, 'latest'] });
    return formatUnits(BigInt(hex === '0x' ? '0x0' : hex), cfg.tokenDecimals || 18, 2);
  }

  async function addToken() {
    if (!cfg.tokenAddress) throw new Error('token_not_deployed');
    return provider().request({
      method: 'wallet_watchAsset',
      params: { type: 'ERC20', options: { address: cfg.tokenAddress, symbol: cfg.tokenSymbol, decimals: cfg.tokenDecimals } },
    });
  }

  /** Assina uma mensagem legível (prova de posse). A verificação no servidor é feita pelo gateway do jogo (SIWE). */
  async function signOwnership() {
    if (!state.address) throw new Error('not_connected');
    const message = [
      `${location.host} quer confirmar que você controla esta carteira:`,
      state.address,
      '',
      'Esta assinatura não custa gás e não autoriza nenhuma transação.',
      `Rede: ${cfg.chainId}`,
      `Data: ${new Date().toISOString()}`,
    ].join('\n');
    const hexMsg = '0x' + Array.from(new TextEncoder().encode(message)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const signature = await provider().request({ method: 'personal_sign', params: [hexMsg, state.address] });
    return { message, signature };
  }

  const p = provider();
  if (p && p.on) {
    p.on('accountsChanged', (accs) => { if (!accs.length) disconnect(); else { state.address = accs[0]; emit(); } });
    p.on('chainChanged', (id) => { state.chainId = parseInt(id, 16); emit(); });
  }

  // Reconecta em silêncio se o usuário já tinha conectado antes
  if (p && wasConnected()) {
    p.request({ method: 'eth_accounts' }).then(async (accs) => {
      if (!accs.length) return;
      state.address = accs[0];
      state.chainId = parseInt(await p.request({ method: 'eth_chainId' }), 16);
      emit();
    }).catch(() => {});
  }

  window.SCC = Object.assign(window.SCC || {}, {
    wallet: {
      connect, disconnect, ensureChain, bnbBalance, tokenBalance, addToken, signOwnership,
      onChange: (fn) => { listeners.add(fn); fn({ ...state }); return () => listeners.delete(fn); },
      get state() { return { ...state }; },
      hasProvider: () => !!provider(),
      short,
    },
  });
})();
