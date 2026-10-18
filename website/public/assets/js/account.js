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

  // Atributos do avatar: demonstração até a API do jogo estar disponível
  const fillBars = (connected) => {
    const demo = { health: 100, happiness: 15, food: 23, energy: 30 };
    document.querySelectorAll('[data-attr]').forEach((el) => {
      el.style.width = connected ? demo[el.dataset.attr] + '%' : '0%';
    });
    $('[data-account-level]').textContent = connected ? '21' : '—';
  };

  async function render({ address, chainId }) {
    const connected = !!address;
    $('[data-wallet-disconnected]').hidden = connected;
    $('[data-wallet-connected]').hidden = !connected;
    $('[data-account-name]').textContent = connected ? wallet.short(address) : 'Visitante';
    fillBars(connected);
    if (!connected) return;

    $('[data-wallet-address]').textContent = address;
    $('[data-wallet-network]').textContent = chainId === cfg.chainId ? cfg.chainName : `Rede ${chainId} (troque para ${cfg.chainName})`;
    try { $('[data-wallet-bnb]').textContent = (await wallet.bnbBalance()) ?? '—'; } catch { $('[data-wallet-bnb]').textContent = '—'; }
    try {
      const t = await wallet.tokenBalance();
      $('[data-wallet-token]').textContent = t ?? 'Contrato ainda não publicado';
    } catch { $('[data-wallet-token]').textContent = '—'; }
  }

  wallet.onChange(render);

  $('[data-wallet-connect]')?.addEventListener('click', async () => {
    try { await wallet.connect(); say('Carteira conectada.'); } catch (e) { say(errorText(e), false); }
  });
  $('[data-wallet-disconnect]')?.addEventListener('click', () => { wallet.disconnect(); say('Desconectado deste site.'); });
  $('[data-wallet-add-token]')?.addEventListener('click', async () => {
    try { await wallet.addToken(); say('SCITY adicionado à carteira.'); } catch (e) { say(errorText(e), false); }
  });
  $('[data-wallet-sign]')?.addEventListener('click', async () => {
    try {
      const { signature } = await wallet.signOwnership();
      say(`Assinatura gerada (${signature.slice(0, 10)}…). No jogo, ela é verificada pelo servidor.`);
    } catch (e) { say(errorText(e), false); }
  });
})();
