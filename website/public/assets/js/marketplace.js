/* Marketplace: filtro por categoria sem recarregar, busca, ordenação e modal de compra. */
(() => {
  'use strict';
  const grid = document.querySelector('[data-listings]');
  if (!grid) return;

  const empty = document.querySelector('[data-empty]');
  const search = document.querySelector('[data-search]');
  const sort = document.querySelector('[data-sort]');
  const modal = document.querySelector('[data-buy-modal]');
  const rarityRank = { common: 0, rare: 1, epic: 2, legendary: 3 };
  const fmt = new Intl.NumberFormat('pt-BR');
  let current = null;

  const apply = () => {
    const q = (search?.value || '').trim().toLowerCase();
    const cards = [...grid.querySelectorAll('.listing')];
    let visible = 0;
    cards.forEach((c) => {
      const show = !q || c.dataset.name.toLowerCase().includes(q) || c.textContent.toLowerCase().includes(q);
      c.hidden = !show;
      if (show) visible++;
    });
    const by = sort?.value || 'price-asc';
    cards.sort((a, b) => {
      if (by === 'rarity') return rarityRank[b.dataset.rarity] - rarityRank[a.dataset.rarity];
      const d = Number(a.dataset.price) - Number(b.dataset.price);
      return by === 'price-desc' ? -d : d;
    }).forEach((c) => grid.appendChild(c));
    if (empty) empty.hidden = visible > 0;
  };
  search?.addEventListener('input', apply);
  sort?.addEventListener('change', apply);

  // Troca de aba: busca o HTML da página da categoria (renderizado pelo PHP) e substitui a grade.
  document.querySelectorAll('[data-category].window-tab').forEach((tab) => {
    tab.addEventListener('click', async (e) => {
      e.preventDefault();
      const cat = tab.dataset.category;
      try {
        const res = await fetch(`?c=${encodeURIComponent(cat)}`, { headers: { Accept: 'text/html' } });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const fresh = doc.querySelector('[data-listings]');
        if (!fresh) throw new Error('bad_response');
        grid.replaceChildren(...fresh.children);
        document.querySelectorAll('.window-tab').forEach((t) => {
          const on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });
        history.replaceState(null, '', `?c=${encodeURIComponent(cat)}`);
        apply();
      } catch {
        location.href = tab.href; // fallback: navegação normal
      }
    });
  });

  // Compra
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-buy]');
    if (!btn) return;
    const card = btn.closest('.listing');
    current = card;
    modal.querySelector('[data-buy-title]').textContent = `Comprar ${card.dataset.name}`;
    modal.querySelector('[data-buy-desc]').textContent = card.dataset.listingId
      ? `Anúncio #${card.dataset.listingId} no contrato do Marketplace. Sua carteira vai pedir duas confirmações: aprovar o SCITY e comprar.`
      : 'A compra é feita no contrato do Marketplace, com sua carteira.';
    modal.querySelector('[data-buy-price]').textContent = fmt.format(Number(card.dataset.price));
    modal.querySelector('[data-buy-status]').textContent = '';
    if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
  });

  modal?.querySelector('[data-buy-confirm]')?.addEventListener('click', async () => {
    const st = modal.querySelector('[data-buy-status]');
    const btn = modal.querySelector('[data-buy-confirm]');
    const w = window.SCC.wallet;
    const chain = window.SCC.chain || {};
    try {
      if (!w.state.address) await w.connect();
      if (!current?.dataset.listingId) {
        st.className = 'form-status is-error';
        st.textContent = 'Anúncio de demonstração: quando o mercado estiver na blockchain, a compra acontece aqui.';
        return;
      }
      if (!chain.tokenAddress || !chain.marketplace) throw Object.assign(new Error('not_deployed'), { code: 'not_deployed' });
      const listingId = BigInt(current.dataset.listingId);
      const price = BigInt(current.dataset.priceWei);
      const word = (v) => v.toString(16).padStart(64, '0');
      const addr = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');
      btn.disabled = true;
      st.className = 'form-status';
      st.textContent = 'Confirme na carteira: aprovar o SCITY para o Marketplace…';
      // approve(spender, amount) do SCITY: só o preço do anúncio.
      await w.waitReceipt(await w.sendTx({ to: chain.tokenAddress, data: `0x095ea7b3${addr(chain.marketplace)}${word(price)}` }));
      st.textContent = 'Confirme na carteira: comprar…';
      // buy(listingId, maxPrice): o preço máximo é o do anúncio, então o vendedor não sobe o preço no caminho.
      await w.waitReceipt(await w.sendTx({ to: chain.marketplace, data: `0xd6febde8${word(listingId)}${word(price)}` }));
      st.className = 'form-status is-ok';
      st.textContent = 'Compra feita! O NFT já está na sua carteira.';
      current.remove();
      apply();
    } catch (err) {
      st.className = 'form-status is-error';
      st.textContent =
        err?.code === 4001 ? 'Você cancelou na carteira.'
          : err?.code === 'reverted' ? 'O contrato recusou: o anúncio pode ter sido vendido ou cancelado, ou falta SCITY.'
            : err?.code === 'not_deployed' ? 'O Marketplace ainda não está publicado nesta rede.'
              : err?.message === 'no_provider' ? 'Instale uma carteira (MetaMask) para comprar.'
                : 'Não foi possível comprar agora. Tente de novo.';
    } finally {
      btn.disabled = false;
    }
  });

  apply();
})();
