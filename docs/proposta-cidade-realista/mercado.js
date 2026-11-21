// Mercado (E3.6): compra e venda de lotes, imóveis e avatares entre jogadores,
// pelo contrato Marketplace. As listagens vêm do chain-indexer; comprar, vender e
// cancelar são transações da carteira do jogador (ele paga o gás).
//
// Carteira: a MetaMask (window.ethereum) ou, na máquina local, a carteira de teste
// do login, direto no anvil. A venda e a compra mudam a posse na blockchain; o
// jogo acompanha pelo chain.sync do world.

const params = new URLSearchParams(location.search);
const INDEXER = params.get('indexer') ?? 'http://127.0.0.1:8040';
const RPC = params.get('rpc') ?? 'http://127.0.0.1:8545';
const VIEM = 'https://esm.sh/viem@2.21.54';
const DEV_WALLET_KEY = 'scc-carteira-de-teste';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const CITY_PREFIX = 'PIT';

const ABI = [
  'function list((address collection,uint256 tokenId)[] items, uint256 price, uint64 expiresAt) returns (uint256)',
  'function buy(uint256 listingId, uint256 maxPrice)',
  'function cancel(uint256 listingId)',
  'function currency() view returns (address)',
  'function feeBps() view returns (uint16)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const scity = (wei) => (Number(BigInt(wei) / 10n ** 14n) / 10_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "12,5" → wei, sem float. */
function toWei(text) {
  const t = String(text).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const [i, f = ''] = t.split('.');
  return BigInt(i) * 10n ** 18n + BigInt(f.padEnd(18, '0'));
}
/** tokenId do LandNFT = cidade << 32 | lote; o código do lote é o número + 1. */
const lotOfToken = (tokenId) => Number(BigInt(tokenId) & 0xffffffffn);
const lotCode = (lot) => `${CITY_PREFIX}-${String(lot + 1).padStart(6, '0')}`;
const lotToken = (lot, city = 1) => ((BigInt(city) << 32n) | BigInt(lot)).toString();

async function api(path) {
  const r = await fetch(INDEXER + path).catch(() => null);
  if (!r) throw new Error(`O chain-indexer (${INDEXER}) não respondeu.`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message ?? `Erro ${r.status}`), { status: r.status });
  return j;
}

/** Mensagem curta para erros de transação (revert do contrato, carteira recusou). */
function txError(error) {
  const m = String(error?.shortMessage ?? error?.message ?? error);
  if (/User rejected|denied/i.test(m)) return 'Você recusou na carteira.';
  const known = {
    ListingStale: 'O vendedor já não tem o item: a listagem caiu.',
    PriceChanged: 'O preço mudou. Atualize a lista.',
    Expired: 'A listagem venceu.',
    NotActive: 'A listagem já foi vendida ou cancelada.',
    AlreadyListed: 'Este item já está à venda.',
    NotOwner: 'A carteira não é dona deste item na blockchain.',
    SelfPurchase: 'Esta listagem é sua.',
    ERC20InsufficientBalance: 'SCITY insuficiente na carteira.',
    EnforcedPause: 'O mercado está pausado.',
  };
  for (const [k, v] of Object.entries(known)) if (m.includes(k)) return v;
  return m.split('\n')[0].slice(0, 160);
}

/**
 * @param {{ getSession: () => any, showLot: (i:number)=>void, focusLot: (i:number)=>Promise<void>|void }} map
 */
export function createMercado(map) {
  let listings = [];
  let marketAddress = null;
  let busy = false;
  let note = '';

  // ─ Carteira: MetaMask ou a carteira de teste no anvil ─
  async function wallet() {
    const viem = await import(VIEM);
    if (window.ethereum) {
      const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const transport = viem.custom(window.ethereum);
      return { viem, address: viem.getAddress(address), client: viem.createWalletClient({ account: viem.getAddress(address), transport }), pub: viem.createPublicClient({ transport }) };
    }
    const key = LOCAL ? localStorage.getItem(DEV_WALLET_KEY) : null;
    if (!key) throw new Error('Conecte a MetaMask (ou, na máquina local, entre com a carteira de teste).');
    const { privateKeyToAccount } = await import(`${VIEM}/accounts`);
    const account = privateKeyToAccount(key);
    const chain = viem.defineChain({ id: 31337, name: 'Anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
    const pub = viem.createPublicClient({ chain, transport: viem.http(RPC) });
    // Só no anvil: a carteira de teste recebe ETH de mentira para o gás.
    if ((await pub.getBalance({ address: account.address })) < 10n ** 17n) {
      await pub.request({ method: 'anvil_setBalance', params: [account.address, '0x8AC7230489E80000'] });
    }
    return { viem, address: account.address, client: viem.createWalletClient({ account, chain, transport: viem.http(RPC) }), pub };
  }

  async function send(w, address, functionName, args) {
    const abi = w.viem.parseAbi(ABI);
    const hash = await w.client.writeContract({ address, abi, functionName, args, chain: w.client.chain ?? null });
    const receipt = await w.pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('A transação reverteu.');
    return receipt;
  }
  const read = (w, address, functionName, args = []) => w.pub.readContract({ address, abi: w.viem.parseAbi(ABI), functionName, args });

  // ─ Painel ─
  const style = document.createElement('style');
  style.textContent = `
    .merc-btn { position: fixed; right: 16px; bottom: 100px; z-index: 6; border: 0; border-radius: 12px; padding: 10px 14px; font: 700 14px system-ui, sans-serif;
      background: #fff; color: #0b1220; box-shadow: 0 4px 14px rgba(0,0,0,.25); cursor: pointer; }
    .merc { position: fixed; right: 332px; top: 92px; bottom: 160px; width: 340px; max-width: calc(100vw - 32px); z-index: 7; overflow-y: auto; padding: 14px 16px; }
    .merc[hidden] { display: none; }
    .merc h2 { font-size: 17px; margin: 0 0 4px; display: flex; justify-content: space-between; align-items: center; }
    .merc ul { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; }
    .merc li { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 10px; padding: 10px; display: grid; gap: 6px; }
    .merc .itens { font-weight: 700; }
    .merc .preco { color: #fbbf24; font-weight: 800; }
    .merc .linha { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .merc .nota { font-size: 12px; margin-top: 8px; }
    .merc-venda { margin-top: 10px; display: grid; gap: 6px; }
    .merc-venda .linha { display: flex; gap: 6px; align-items: center; }
    .merc-venda input[type=text] { flex: 1; min-width: 0; background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 7px 9px; color: inherit; }
    body.sv-on .merc-btn, body.sv-on .merc { display: none !important; }
    @media (max-width: 1000px) { .merc { right: 16px; } }
    @media (max-width: 640px) { .merc-btn { bottom: 450px; right: 10px; } .merc { top: auto; bottom: 8px; height: 60vh; } }
  `;
  document.head.append(style);
  const button = document.createElement('button');
  button.className = 'merc-btn';
  button.type = 'button';
  button.textContent = '🛒 Mercado';
  document.body.append(button);
  const panel = document.createElement('aside');
  panel.className = 'merc glass';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Mercado');
  document.body.append(panel);
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) refresh();
  });

  const me = () => (map.getSession()?.address ?? '').toLowerCase() || null;

  function itemLabel(i) {
    if (i.collection === 'LandNFT') return `Lote ${lotCode(lotOfToken(i.token_id))}`;
    if (i.collection === 'PropertyNFT') return 'Imóvel do lote';
    if (i.collection === 'AvatarNFT') return `Avatar #${i.token_id}`;
    return `${i.collection} #${i.token_id}`;
  }

  function render() {
    const mine = me();
    const rows = listings
      .map((l) => {
        const own = mine && l.seller === mine;
        const lot = l.items.find((i) => i.collection === 'LandNFT');
        return `<li>
          <span class="itens">${l.items.map((i) => esc(itemLabel(i))).join(' + ')}${l.items.length > 1 ? ' <span class="muted">(combo)</span>' : ''}</span>
          <span class="linha"><span class="preco">${scity(l.price_wei)} SCITY</span><span class="muted pequeno">· ${own ? 'você' : esc(short(l.seller))} · até ${new Date(l.expires_at).toLocaleDateString('pt-BR')}</span></span>
          <span class="linha">
            ${lot ? `<button class="btn btn--ghost pequeno" type="button" data-ver="${lotOfToken(lot.token_id)}">Ver no mapa</button>` : ''}
            ${own
              ? `<button class="btn btn--ghost pequeno" type="button" data-cancelar="${esc(l.listing_id)}" ${busy ? 'disabled' : ''}>Cancelar</button>`
              : `<button class="btn btn--primary pequeno" type="button" data-comprar="${esc(l.listing_id)}" ${busy ? 'disabled' : ''}>Comprar</button>`}
          </span></li>`;
      })
      .join('');
    panel.innerHTML = `<h2><span>🛒 Mercado</span><button class="btn btn--ghost pequeno" type="button" data-fechar>Fechar</button></h2>
      <p class="muted pequeno">Lotes, imóveis e avatares à venda entre jogadores, em SCITY, pela carteira. Taxa de 2,5% para a tesouraria. Para vender, abra a ficha de um lote seu que já está na blockchain.</p>
      ${listings.length ? `<ul>${rows}</ul>` : '<p class="muted">Nada à venda agora.</p>'}
      ${note ? `<p class="nota">${esc(note)}</p>` : ''}`;
  }

  async function refresh() {
    try {
      const r = await api('/v1/market/listings');
      listings = r.listings;
      marketAddress = r.marketplace;
      if (!marketAddress) note = 'O Marketplace não está configurado no chain-indexer.';
    } catch (error) {
      listings = [];
      note = error.message;
    }
    render();
  }

  async function act(fn) {
    if (busy) return;
    busy = true;
    note = 'Confirme na carteira…';
    render();
    try {
      note = await fn();
    } catch (error) {
      note = txError(error);
    } finally {
      busy = false;
    }
    // O indexer precisa de um instante para ler o bloco novo.
    await new Promise((r) => setTimeout(r, 1500));
    await refresh();
  }

  async function buy(id) {
    const l = listings.find((x) => x.listing_id === id);
    if (!l) return;
    await act(async () => {
      const w = await wallet();
      const currency = await read(w, marketAddress, 'currency');
      const price = BigInt(l.price_wei);
      if ((await read(w, currency, 'balanceOf', [w.address])) < price) throw new Error('ERC20InsufficientBalance');
      if ((await read(w, currency, 'allowance', [w.address, marketAddress])) < price) {
        note = 'Autorize o SCITY na carteira…';
        render();
        await send(w, currency, 'approve', [marketAddress, price]);
      }
      note = 'Confirme a compra na carteira…';
      render();
      await send(w, marketAddress, 'buy', [BigInt(id), price]);
      return `Comprado: ${l.items.map(itemLabel).join(' + ')}. O jogo atualiza a posse em instantes.`;
    });
  }

  async function cancel(id) {
    await act(async () => {
      const w = await wallet();
      await send(w, marketAddress, 'cancel', [BigInt(id)]);
      return 'Listagem cancelada.';
    });
  }

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-fechar')) panel.hidden = true;
    else if (b.dataset.comprar) buy(b.dataset.comprar);
    else if (b.dataset.cancelar) cancel(b.dataset.cancelar);
    else if (b.dataset.ver) map.focusLot(Number(b.dataset.ver));
  });

  /**
   * Ficha do lote: se a carteira do jogador é dona do lote na blockchain, mostra
   * "Vender no mercado" (com o imóvel junto, se ele também estiver na carteira).
   */
  let decorating = 0;
  async function decorateLot(i, ficha) {
    const mine = me();
    if (!mine) return;
    // Só vale a ficha mais recente: abrir o lote de novo no meio da consulta não duplica a caixa.
    const turn = ++decorating;
    const tokenId = lotToken(i);
    let owner;
    try {
      owner = (await api(`/v1/chain/owners/${mine}`)) ?? {};
    } catch {
      return;
    }
    if (turn !== decorating || !owner.lots?.some((l) => l.token_id === tokenId) || !ficha.isConnected) return;
    const property = owner.properties?.find((p) => p.lot_id === tokenId);
    const listed = (await api('/v1/market/listings').catch(() => ({ listings: [] }))).listings.find((l) => l.items.some((it) => it.token_id === tokenId));
    marketAddress ??= (await api('/v1/market/listings').catch(() => ({}))).marketplace;
    if (turn !== decorating) return;
    ficha.querySelector('.merc-venda')?.remove();
    const box = document.createElement('div');
    box.className = 'gestao merc-venda';
    box.innerHTML = listed
      ? `<h3>🛒 No mercado</h3><p class="muted pequeno">À venda por <b>${scity(listed.price_wei)} SCITY</b>${listed.items.length > 1 ? ', com o imóvel' : ''}.</p>
         <button class="btn btn--ghost pequeno" type="button" data-cancelar="${esc(listed.listing_id)}">Cancelar a venda</button><p class="muted pequeno" data-msg></p>`
      : `<h3>🛒 Vender no mercado</h3>
         <form class="linha" data-vender><input type="text" name="preco" inputmode="decimal" required placeholder="Preço em SCITY" aria-label="Preço em SCITY" />
         <button class="btn btn--primary pequeno" type="submit">Vender</button></form>
         ${property ? '<label class="pequeno"><input type="checkbox" data-combo checked> Junto com o imóvel (combo)</label>' : ''}
         <p class="muted pequeno">Fica à venda por 7 dias. A taxa de 2,5% sai do preço. O lote só passa ao comprador na venda.</p><p class="muted pequeno" data-msg></p>`;
    ficha.append(box);
    const msg = (t) => (box.querySelector('[data-msg]').textContent = t);
    box.querySelector('[data-cancelar]')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      box.dataset.busy = '1';
      try {
        const w = await wallet();
        msg('Confirme na carteira…');
        await send(w, marketAddress, 'cancel', [BigInt(listed.listing_id)]);
        msg('Venda cancelada.');
      } catch (error) {
        msg(txError(error));
        e.target.disabled = false;
      } finally {
        delete box.dataset.busy;
      }
    });
    box.querySelector('[data-vender]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const price = toWei(new FormData(e.target).get('preco'));
      if (!price || price === 0n) return msg('Preço inválido.');
      const submit = e.target.querySelector('button');
      submit.disabled = true;
      box.dataset.busy = '1';
      try {
        if (!marketAddress) throw new Error('O Marketplace não está configurado no chain-indexer.');
        const w = await wallet();
        if (w.address.toLowerCase() !== mine) throw new Error(`A carteira conectada (${short(w.address)}) não é a da sua conta.`);
        const status = await api('/v1/chain/status');
        const items = [{ collection: status.contracts.LandNFT, tokenId: BigInt(tokenId) }];
        if (property && box.querySelector('[data-combo]')?.checked) items.push({ collection: status.contracts.PropertyNFT, tokenId: BigInt(property.token_id) });
        for (const it of items) {
          if (!(await read(w, it.collection, 'isApprovedForAll', [w.address, marketAddress]))) {
            msg('Autorize o mercado na carteira…');
            await send(w, it.collection, 'setApprovalForAll', [marketAddress, true]);
          }
        }
        const block = await w.pub.getBlock();
        msg('Confirme a venda na carteira…');
        await send(w, marketAddress, 'list', [items, price, block.timestamp + 7n * 86_400n]);
        msg(`À venda por ${scity(price)} SCITY.`);
      } catch (error) {
        msg(txError(error));
        submit.disabled = false;
      } finally {
        delete box.dataset.busy;
      }
    });
  }

  return { refresh, decorateLot, open: () => { panel.hidden = false; refresh(); }, listings: () => listings };
}
