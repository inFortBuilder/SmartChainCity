/* Venda privada: calculadora de tokens e conexão da carteira. */
(() => {
  'use strict';
  const form = document.querySelector('[data-sale-form]');
  if (!form) return;

  const sale = window.SCC.sale;
  const input = form.elements.usd;
  const out = document.querySelector('[data-sale-tokens]');
  const status = document.querySelector('[data-sale-status]');
  const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

  const calc = () => {
    const usd = Number(input.value);
    const ok = usd >= sale.minUsd && usd <= sale.maxUsd;
    out.textContent = ok && sale.priceUsd > 0 ? fmt.format(usd / sale.priceUsd) : '—';
    input.classList.toggle('field-error', !ok);
    return ok;
  };
  input.addEventListener('input', calc);
  calc();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sale.open) { status.textContent = 'A venda ainda não está aberta.'; status.className = 'form-status is-error'; return; }
    if (!calc()) { status.textContent = `Informe um valor entre US$ ${sale.minUsd} e US$ ${sale.maxUsd}.`; status.className = 'form-status is-error'; return; }
    try {
      await window.SCC.wallet.connect();
      // Aqui entra a aprovação do BUSD e a chamada ao contrato de venda, quando publicado.
      status.textContent = 'Carteira conectada. O contrato da venda será exibido aqui quando publicado e auditado.';
      status.className = 'form-status is-ok';
    } catch (err) {
      status.textContent = err?.code === 4001 ? 'Você cancelou na carteira.' : 'Não foi possível conectar a carteira.';
      status.className = 'form-status is-error';
    }
  });
})();
