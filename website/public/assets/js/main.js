/* Smart Chain City — comportamento comum a todas as páginas. */
(() => {
  'use strict';

  /** Mostra uma mensagem curta no rodapé da tela. */
  const toast = (msg, ms = 2600) => {
    const el = document.querySelector('.toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, ms);
  };
  window.SCC = Object.assign(window.SCC || {}, { toast });

  // Menu mobile
  const toggle = document.querySelector('.nav-toggle');
  const links = document.getElementById('menu-principal');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    });
    links.addEventListener('click', (e) => {
      if (e.target.closest('a')) { links.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); }
    });
  }

  // Aviso de incidente (E4.6): saque ou câmbio suspensos pela operação aparecem no topo de todas as páginas.
  const banner = document.querySelector('[data-incident]');
  if (banner) {
    fetch(`${window.SCC.baseUrl}/api/status.php`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const labels = { withdrawals: 'Saques', exchange: 'Câmbio' };
        const frozen = Object.entries(data?.switches ?? {}).filter(([, s]) => s && s.frozen);
        if (!frozen.length) return;
        const parts = frozen.map(([name, s]) => `${labels[name] ?? name} suspenso${name === 'withdrawals' ? 's' : ''}${s.reason ? ` (${s.reason})` : ''}`);
        banner.textContent = `⛔ ${parts.join(' · ')}. Seus saldos estão seguros. Acompanhe no Discord.`;
        banner.hidden = false;
      })
      .catch(() => {});
  }

  // Copiar endereço do contrato
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast('Copiado!');
      } catch {
        toast('Não foi possível copiar. Selecione e copie manualmente.');
      }
    });
  });

  // Contadores animados do painel de estatísticas
  const fmt = new Intl.NumberFormat('pt-BR');
  const animate = (el, to) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { el.textContent = fmt.format(to); return; }
    const start = performance.now();
    const dur = 1400;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      el.textContent = fmt.format(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // Revelação ao rolar + início dos contadores quando visíveis
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target;
      if (el.hasAttribute('data-reveal')) el.classList.add('is-visible');
      if (el.hasAttribute('data-count')) animate(el, Number(el.dataset.count));
      io.unobserve(el);
    });
  }, { threshold: 0.15 }) : null;
  document.querySelectorAll('[data-reveal], [data-count]').forEach((el) => {
    if (io) io.observe(el); else el.classList.add('is-visible');
  });

  // Atualiza as estatísticas pela API a cada 60 s (se a página tiver o painel)
  const panel = document.querySelector('[data-stats]');
  if (panel) {
    const refresh = async () => {
      try {
        const res = await fetch(`${window.SCC.baseUrl}/api/stats.php`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const data = await res.json();
        panel.querySelectorAll('[data-stat]').forEach((el) => {
          const v = data[el.dataset.stat];
          if (typeof v === 'number') el.textContent = fmt.format(v);
        });
      } catch { /* mantém os valores atuais */ }
    };
    setInterval(refresh, 60000);
  }

  // Vídeo: troca a capa pelo iframe só quando o usuário clica (economiza banda)
  document.querySelectorAll('[data-video]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.video;
      if (!/^https:\/\//.test(src)) return;
      const iframe = document.createElement('iframe');
      iframe.src = src + (src.includes('?') ? '&' : '?') + 'autoplay=1';
      iframe.title = 'Vídeo Smart Chain City';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
      iframe.allowFullscreen = true;
      btn.replaceChildren(iframe);
    }, { once: true });
  });

  // Formulários enviados por fetch (contato)
  document.querySelectorAll('form[data-ajax-form]').forEach((form) => {
    const status = form.querySelector('.form-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('.field-error').forEach((f) => f.classList.remove('field-error'));
      if (!form.checkValidity()) {
        form.querySelectorAll(':invalid').forEach((f) => f.classList.add('field-error'));
        status.textContent = 'Preencha os campos obrigatórios.';
        status.className = 'form-status full is-error';
        return;
      }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      status.textContent = 'Enviando…';
      status.className = 'form-status full';
      try {
        const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (data.ok) {
          status.textContent = data.message || 'Mensagem enviada!';
          status.className = 'form-status full is-ok';
          form.reset();
        } else {
          Object.keys(data.fields || {}).forEach((name) => form.elements[name]?.classList.add('field-error'));
          status.textContent = data.error || 'Não foi possível enviar.';
          status.className = 'form-status full is-error';
        }
      } catch {
        status.textContent = 'Falha de conexão. Tente novamente.';
        status.className = 'form-status full is-error';
      } finally {
        btn.disabled = false;
      }
    });
  });
})();
