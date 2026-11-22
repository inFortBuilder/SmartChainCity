/* Página "Minha conta": conexão da carteira, saldos e assinatura de posse. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const wallet = window.SCC.wallet;
  const status = $('[data-wallet-status]');
  const say = (msg, ok = true) => { if (status) { status.textContent = msg; status.className = 'form-status ' + (ok ? 'is-ok' : 'is-error'); } };
  const cfg = window.SCC.chain;

  const errorText = (err) => {
    if (err?.code === 4001) return 'Você cancelou na carteira.';
    if (err?.message === 'no_provider') return 'Nenhuma carteira encontrada neste navegador.';
    if (err?.message === 'token_not_deployed') return 'O contrato do SCITY ainda não foi publicado.';
    return 'Não foi possível concluir. Tente novamente.';
  };

  // Barras do HUD com os atributos do avatar (0 a 10). Sem login no jogo, vazias.
  const fillBars = (attrs) => {
    document.querySelectorAll('[data-attr]').forEach((el) => {
      const v = attrs ? Number(attrs[el.dataset.attr] ?? 0) : 0;
      el.style.width = Math.max(0, Math.min(10, v)) * 10 + '%';
    });
  };
  const rarityShort = { common: 'C', rare: 'R', epic: 'E', legendary: 'L' };
  const money = (amount, decimals) => {
    const v = BigInt(amount || '0');
    const base = 10n ** BigInt(decimals);
    const frac = (v % base).toString().padStart(decimals, '0').slice(0, 2);
    return new Intl.NumberFormat('pt-BR').format(v / base) + ',' + frac;
  };

  /** O card e o painel "No jogo" com os dados do servidor (gateway, game-core e economy). */
  async function renderGame() {
    const game = window.SCC.game;
    const box = $('[data-game-session]');
    let p = null;
    try { p = await game.profile(); } catch (e) {
      if (e?.status === 401) game.signOut();
    }
    if (box) box.hidden = !p;
    if (!p) {
      fillBars(null);
      $('[data-account-level]').textContent = '—';
      return;
    }
    const bal = (cur) => p.balances.find((b) => b.currency === cur);
    const t = bal('THALER');
    const s = bal('SCITY');
    $('[data-game-account]').textContent = p.me.account.email || window.SCC.wallet.short(p.session.address);
    $('[data-game-thaler]').textContent = t ? money(t.amount, t.decimals ?? 2) : '0,00';
    $('[data-game-scity]').textContent = s ? money(s.amount, s.decimals ?? 18) : '0,00';
    const a = p.avatar;
    $('[data-game-avatar]').textContent = a ? `${a.job.label} (${a.rarity})` : 'Ainda sem avatar: ele vem da Lucky Box';
    if (a) {
      $('[data-account-name]').textContent = a.job.label;
      $('[data-account-level]').textContent = rarityShort[a.rarity] ?? '—';
    }
    fillBars(a ? a.attributes : null);
  }

  async function render({ address, chainId }) {
    const connected = !!address;
    $('[data-wallet-disconnected]').hidden = connected;
    $('[data-wallet-connected]').hidden = !connected;
    $('[data-account-name]').textContent = connected ? wallet.short(address) : 'Visitante';
    renderGame();
    if (!connected) return;

    $('[data-wallet-address]').textContent = address;
    $('[data-wallet-network]').textContent = chainId === cfg.chainId ? cfg.chainName : `Rede ${chainId} (troque para ${cfg.chainName})`;
    try { $('[data-wallet-bnb]').textContent = (await wallet.bnbBalance()) ?? '—'; } catch { $('[data-wallet-bnb]').textContent = '—'; }
    try {
      const t = await wallet.tokenBalance();
      $('[data-wallet-token]').textContent = t ?? 'Contrato ainda não publicado';
    } catch { $('[data-wallet-token]').textContent = '—'; }
  }

  // ---------------------------------------------------------------- depósito no GameVault

  /** Texto decimal ("12,5") → wei (18 casas), sem float. null se inválido. */
  const toWei = (text) => {
    const t = String(text).trim().replace(',', '.');
    if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
    const [i, f = ''] = t.split('.');
    const v = BigInt(i) * 10n ** 18n + BigInt(f.padEnd(18, '0'));
    return v > 0n ? v : null;
  };
  const word = (v) => v.toString(16).padStart(64, '0');
  const addr = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');
  const depStatus = $('[data-deposit-status]');
  const depSay = (msg, ok = true) => { if (depStatus) { depStatus.textContent = msg; depStatus.className = 'form-status ' + (ok ? 'is-ok' : 'is-error'); } };

  /** Os depósitos da carteira (chain-indexer, pelo próprio site). */
  async function renderDeposits(address) {
    const list = $('[data-deposit-list]');
    if (!list) return;
    if (!address) { list.hidden = true; return; }
    try {
      const r = await fetch(`${window.SCC.baseUrl}/api/deposits.php?wallet=${address}`, { headers: { Accept: 'application/json' } }).then((x) => x.json());
      const items = r.deposits ?? [];
      list.replaceChildren(...items.slice(0, 5).map((d) => {
        const li = document.createElement('li');
        li.textContent = `${money(d.amount_wei, 18)} SCITY · ${d.status === 'credited' ? 'no jogo' : 'aguardando confirmações'}`;
        return li;
      }));
      list.hidden = items.length === 0;
    } catch { list.hidden = true; }
  }

  $('[data-deposit-form]')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('[data-deposit-submit]');
    const amount = toWei($('[data-deposit-amount]').value);
    if (!amount) return depSay('Valor inválido.', false);
    if (!cfg.vault || !cfg.tokenAddress) return depSay('O cofre ainda não foi publicado nesta rede.', false);
    btn.disabled = true;
    try {
      if (!wallet.state.address) await wallet.connect();
      const me = wallet.state.address;
      // Saldo de SCITY na carteira antes de pedir as assinaturas (balanceOf).
      const hex = await window.ethereum.request({ method: 'eth_call', params: [{ to: cfg.tokenAddress, data: '0x70a08231' + addr(me) }, 'latest'] });
      if (BigInt(hex === '0x' ? '0x0' : hex) < amount) { depSay('A carteira não tem esse SCITY.', false); return; }
      depSay('Confirme na carteira: aprovar o SCITY para o cofre…');
      await wallet.waitReceipt(await wallet.sendTx({ to: cfg.tokenAddress, data: '0x095ea7b3' + addr(cfg.vault) + word(amount) }));
      depSay('Confirme na carteira: depositar…');
      // deposit(amount) do GameVault (0xb6b55f25): o chain-indexer credita o ledger depois das confirmações.
      await wallet.waitReceipt(await wallet.sendTx({ to: cfg.vault, data: '0xb6b55f25' + word(amount) }));
      depSay('Depósito enviado. Vira saldo no jogo depois das confirmações da rede.');
      $('[data-deposit-amount]').value = '';
      await renderDeposits(me);
      // O crédito no ledger vem logo depois: atualiza o painel do jogo e a lista em alguns segundos.
      setTimeout(() => { renderDeposits(me); renderGame(); }, 6000);
    } catch (e) {
      depSay(e?.code === 4001 ? 'Você cancelou na carteira.'
        : e?.code === 'reverted' ? 'O cofre recusou: ele pode estar pausado.'
          : errorText(e), false);
    } finally {
      btn.disabled = false;
    }
  });

  wallet.onChange((s) => renderDeposits(s.address));
  wallet.onChange(render);

  $('[data-wallet-connect]')?.addEventListener('click', async () => {
    try { await wallet.connect(); say('Carteira conectada.'); } catch (e) { say(errorText(e), false); }
  });
  $('[data-wallet-disconnect]')?.addEventListener('click', () => { wallet.disconnect(); say('Desconectado deste site.'); });
  $('[data-wallet-add-token]')?.addEventListener('click', async () => {
    try { await wallet.addToken(); say('SCITY adicionado à carteira.'); } catch (e) { say(errorText(e), false); }
  });
  // Entrar no jogo: SIWE pelo gateway. A assinatura não custa gás nem autoriza transação.
  $('[data-game-login]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    say('Confirme a assinatura na carteira…');
    try {
      await window.SCC.game.signIn();
      say('Você entrou no jogo.');
      await renderGame();
    } catch (e) {
      const msg = {
        4001: 'Você cancelou na carteira.',
        offline: 'O servidor do jogo não respondeu. Tente mais tarde.',
        api_off: 'O login no jogo ainda não está disponível neste site.',
        captcha: 'Não deu para resolver o captcha. Tente de novo.',
        invalid_siwe_domain: 'Este site não está autorizado no servidor do jogo.',
        invalid_siwe_chain: 'Rede não aceita pelo servidor do jogo.',
        account_blocked: 'Conta bloqueada.',
      }[e?.code] ?? (e?.message && e.code ? e.message : errorText(e));
      say(msg, false);
    } finally {
      btn.disabled = false;
    }
  });
  $('[data-game-logout]')?.addEventListener('click', async () => {
    window.SCC.game.signOut();
    say('Você saiu do jogo neste site.');
    await renderGame();
  });
})();
