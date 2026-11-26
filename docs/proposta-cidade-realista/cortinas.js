// Cortinas laterais à esquerda: painéis que ocupam da barra do topo até a base da tela, com a rolagem do
// lado esquerdo, e abrem pelas abas na borda da tela. Uma cortina aberta por vez (elas dividem o espaço).
//
//   const cortinas = createCortinas([
//     { name: 'jogo', el: painelDoJogo, label: 'Jogo', icon: '🎮', open: true },
//     { name: 'camadas', el: painelDeCamadas, label: 'Camadas', icon: '🗺️' },
//   ]);
//   cortinas.open('jogo'); cortinas.close(); cortinas.toggle('camadas');
//
// Outros módulos pedem pelo evento `cortina` no document: { detail: { name, open } }. Sem `name`, fecha todas.
// A escolha fica guardada no navegador (qual cortina estava aberta), para a próxima visita.
const KEY = 'scc-cortina-aberta';

export function createCortinas(items) {
  const rail = document.createElement('nav');
  rail.className = 'cortina-trilho';
  rail.setAttribute('aria-label', 'Painéis laterais');
  document.body.append(rail);

  const byName = new Map();
  for (const it of items) {
    it.el.classList.add('cortina');
    it.el.id ||= `cortina-${it.name}`;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'cortina-aba glass';
    tab.dataset.cortina = it.name;
    tab.setAttribute('aria-controls', it.el.id);
    tab.innerHTML = `<span aria-hidden="true">${it.icon}</span><span class="cortina-aba__txt">${it.label}</span>`;
    tab.title = it.label;
    rail.append(tab);
    byName.set(it.name, { ...it, tab });
  }

  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    saved = null;
  }

  function apply(openName) {
    for (const [name, it] of byName) {
      const on = name === openName;
      it.el.classList.toggle('cortina--aberta', on);
      // Fechada, a cortina sai da tela e do foco do teclado.
      it.el.inert = !on;
      it.el.setAttribute('aria-hidden', String(!on));
      it.tab.setAttribute('aria-expanded', String(on));
      it.tab.classList.toggle('is-active', on);
    }
    document.body.classList.toggle('cortina-on', openName !== null);
    try {
      localStorage.setItem(KEY, openName ?? '');
    } catch {
      /* armazenamento indisponível */
    }
    current = openName;
  }

  let current = null;
  const initial = saved !== null ? (byName.has(saved) ? saved : null) : (items.find((i) => i.open)?.name ?? null);
  apply(initial);

  const api = {
    open: (name) => apply(byName.has(name) ? name : null),
    close: () => apply(null),
    toggle: (name) => apply(current === name ? null : name),
    current: () => current,
  };

  rail.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cortina]');
    if (b) api.toggle(b.dataset.cortina);
  });
  document.addEventListener('cortina', (e) => {
    const { name, open } = e.detail ?? {};
    if (!name) return api.close();
    if (open) api.open(name);
    else if (current === name) api.close();
  });
  // Esc fecha a cortina aberta.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current && !e.target.closest('input, textarea, select')) api.close();
  });
  return api;
}
