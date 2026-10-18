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
    modal.querySelector('[data-buy-desc]').textContent = 'A compra é feita no contrato do Marketplace, com sua carteira.';
    modal.querySelector('[data-buy-price]').textContent = fmt.format(Number(card.dataset.price));
    modal.querySelector('[data-buy-status]').textContent = '';
    if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
  });

  modal?.querySelector('[data-buy-confirm]')?.addEventListener('click', async () => {
    const st = modal.querySelector('[data-buy-status]');
    try {
      if (!window.SCC.wallet.state.address) await window.SCC.wallet.connect();
      // O contrato Marketplace ainda não foi publicado: aqui entra a chamada buy(listingId) (docs/07 §2.5).
      st.className = 'form-status is-error';
      st.textContent = `Carteira ${window.SCC.wallet.short(window.SCC.wallet.state.address)} conectada. O marketplace on-chain abre na fase Beta — anúncio ${current?.dataset.id} reservado para teste.`;
    } catch (err) {
      st.className = 'form-status is-error';
      st.textContent = err?.code === 4001 ? 'Você cancelou na carteira.' : 'Conecte uma carteira para comprar.';
    }
  });

  apply();
})();
