/* Marketplace no site: vender (preço fixo ou leilão), dar lance e encerrar leilão.
 * Transações pela carteira (EIP-1193), com a ABI montada à mão (sem bibliotecas). */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const w = window.SCC.wallet;
  const chain = window.SCC.chain || {};
  const SEL = { list: '8fbf08e2', createAuction: 'e2d478bc', bid: '598647f8', settle: '8df82800', approve: '095ea7b3', setApprovalForAll: 'a22cb465', isApprovedForAll: 'e985e9c5' };
  const word = (v) => BigInt(v).toString(16).padStart(64, '0');
  const addr = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');
  const toWei = (text) => {
    const t = String(text).trim().replace(',', '.');
    if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
    const [i, f = ''] = t.split('.');
    const v = BigInt(i) * 10n ** 18n + BigInt(f.padEnd(18, '0'));
    return v > 0n ? v : null;
  };
  const errText = (e) =>
    e?.code === 4001 ? 'Você cancelou na carteira.'
      : e?.code === 'reverted' ? 'O contrato recusou a operação.'
        : e?.message === 'no_provider' ? 'Instale uma carteira (MetaMask) para continuar.'
          : 'Não foi possível concluir agora. Tente de novo.';
  const send = async (to, data) => w.waitReceipt(await w.sendTx({ to, data }));

  /** (address,uint256)[] seguido de dois inteiros: list(items, price, expiresAt) e createAuction(items, start, duration). */
  const itemsCall = (sel, items, a, b) =>
    '0x' + sel + word(0x60) + word(a) + word(b) + word(items.length) + items.map((i) => addr(i.collection) + word(i.tokenId)).join('');

  // ------------------------------------------------------------ leilões

  const aStatus = $('[data-auction-status]');
  const aSay = (m, ok = true) => { if (aStatus) { aStatus.textContent = m; aStatus.className = 'form-status ' + (ok ? 'is-ok' : 'is-error'); } };
  document.querySelectorAll('.auction').forEach((li) => {
    const id = li.dataset.auctionId;
    $('[data-bid-form]', li)?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const amount = toWei(new FormData(ev.target).get('valor'));
      if (!amount) return aSay('Lance inválido.', false);
      if (amount < BigInt(li.dataset.minimumWei)) return aSay('O lance precisa ser pelo menos o mínimo.', false);
      try {
        if (!w.state.address) await w.connect();
        aSay('Confirme na carteira: aprovar o SCITY do lance…');
        await send(chain.tokenAddress, '0x' + SEL.approve + addr(chain.marketplace) + word(amount));
        aSay('Confirme na carteira: dar o lance…');
        await send(chain.marketplace, '0x' + SEL.bid + word(id) + word(amount));
        aSay('Lance feito! Se alguém cobrir, o SCITY volta para a sua carteira na hora.');
        setTimeout(() => location.reload(), 2500);
      } catch (e) { aSay(errText(e), false); }
    });
    $('[data-settle]', li)?.addEventListener('click', async () => {
      try {
        if (!w.state.address) await w.connect();
        aSay('Confirme na carteira: encerrar o leilão…');
        await send(chain.marketplace, '0x' + SEL.settle + word(id));
        aSay('Leilão encerrado: o NFT foi para quem venceu e o SCITY para o vendedor.');
        setTimeout(() => location.reload(), 2500);
      } catch (e) { aSay(errText(e), false); }
    });
  });

  // ------------------------------------------------------------ vender

  const panel = $('[data-sell]');
  if (!panel) return;
  const form = $('[data-sell-form]');
  const sStatus = $('[data-sell-status]');
  const sSay = (m, ok = true) => { sStatus.textContent = m; sStatus.className = 'form-status ' + (ok ? 'is-ok' : 'is-error'); };
  const collections = chain.collections || {};

  async function loadOwned(address) {
    const box = $('[data-sell-items]');
    box.querySelectorAll('label').forEach((l) => l.remove());
    if (!address) { form.hidden = true; $('[data-sell-connect]').hidden = false; return; }
    $('[data-sell-connect]').hidden = true;
    const r = await fetch(`${window.SCC.baseUrl}/api/owned.php?wallet=${address}`, { headers: { Accept: 'application/json' } }).then((x) => x.json()).catch(() => ({ items: null }));
    const items = (r.items ?? []).filter((i) => collections[i.category]);
    if (!items.length) {
      $('[data-sell-hint]').textContent = r.items === null ? 'Não deu para ler seus NFTs agora.' : 'Esta carteira não tem lotes, imóveis nem avatares na blockchain.';
      form.hidden = true;
      return;
    }
    $('[data-sell-hint]').textContent = `Carteira ${w.short(address)}: escolha o que vender.`;
    for (const it of items) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'item';
      input.value = `${it.category}:${it.token_id}`;
      label.append(input, ' ', it.name);
      box.append(label);
    }
    form.hidden = false;
  }

  /** Mostra só os campos do modo escolhido (preço fixo: dias; leilão: horas). */
  const syncMode = () => {
    const mode = new FormData(form).get('modo') || 'fixo';
    form.querySelectorAll('[data-mode]').forEach((el) => {
      el.hidden = el.dataset.mode !== mode;
      el.querySelector('input').disabled = el.dataset.mode !== mode;
    });
  };
  form.addEventListener('change', (ev) => { if (ev.target.name === 'modo') syncMode(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const picked = f.getAll('item').map((v) => { const [category, tokenId] = String(v).split(':'); return { collection: collections[category], tokenId }; });
    if (!picked.length) return sSay('Escolha pelo menos um item.', false);
    if (picked.length > 5) return sSay('No máximo 5 itens por anúncio.', false);
    const price = toWei(f.get('preco'));
    if (!price) return sSay('Preço inválido.', false);
    const auction = f.get('modo') === 'leilao';
    try {
      if (!w.state.address) await w.connect();
      const me = w.state.address;
      // Permissão do mercado, uma vez por coleção (isApprovedForAll antes, para não pedir de novo).
      for (const col of [...new Set(picked.map((p) => p.collection))]) {
        const ok = await window.ethereum.request({ method: 'eth_call', params: [{ to: col, data: '0x' + SEL.isApprovedForAll + addr(me) + addr(chain.marketplace) }, 'latest'] });
        if (BigInt(ok === '0x' ? '0x0' : ok) === 0n) {
          sSay('Confirme na carteira: permitir que o mercado movimente esta coleção…');
          await send(col, '0x' + SEL.setApprovalForAll + addr(chain.marketplace) + word(1));
        }
      }
      sSay('Confirme na carteira: anunciar…');
      if (auction) {
        const hours = Number(f.get('horas'));
        await send(chain.marketplace, itemsCall(SEL.createAuction, picked, price, BigInt(hours * 3600)));
        sSay('Leilão aberto! Ele aparece na lista quando a rede confirmar.');
      } else {
        const days = Number(f.get('dias'));
        await send(chain.marketplace, itemsCall(SEL.list, picked, price, BigInt(Math.floor(Date.now() / 1000) + days * 86400)));
        sSay('Anúncio publicado! Ele aparece na lista quando a rede confirmar.');
      }
      form.reset();
      syncMode();
      loadOwned(me);
    } catch (e) { sSay(errText(e), false); }
  });

  $('[data-sell-connect]')?.addEventListener('click', async () => {
    try { await w.connect(); } catch (e) { sSay(errText(e), false); }
  });
  w.onChange((s) => loadOwned(s.address));
})();
