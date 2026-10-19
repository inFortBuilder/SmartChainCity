/**
 * O editor em português, espanhol e inglês.
 *
 * O texto é escrito em português, e o português É a chave:
 * t('Carregue um modelo primeiro.'). Os dicionários ficam ao lado,
 * en.js e es.js, um objeto [texto em português => tradução].
 *
 * Parâmetros em ^1..^4: a ordem das palavras muda entre os idiomas, e
 * concatenar fixaria a do português.
 *
 *   t('Carregando ^1', arquivo.name)
 *
 * No HTML, o elemento traduzível diz a chave num atributo e continua com o
 * português dentro — é o que aparece se o JavaScript falhar:
 *
 *   data-t="…"             o texto do elemento
 *   data-t-html="…"        o HTML do elemento (texto com <strong>, <code>…)
 *   data-t-title="…"       o title
 *   data-t-aria="…"        o aria-label
 *   data-t-placeholder="…" o placeholder
 *
 * De onde vem o idioma: ?lang= na URL (é como o jogo diz o idioma de
 * quem abriu), a última escolha guardada neste navegador, o idioma do
 * navegador, e português. Fora do navegador (o CLI em Node) e nos testes, é
 * sempre português — os testes conferem as mensagens como estão escritas.
 *
 * Sem entrada no dicionário, fica o português. O tests/traducao.test.js
 * reprova texto sem en ou es.
 *
 * O que vai para a API, para o log e para o nome de arquivo fica em
 * português: quem lê não é a pessoa na tela.
 */
import en from './en.js';
import es from './es.js';

const IDIOMAS = ['pt', 'en', 'es'];
const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

export const dicionarios = { en, es };

function valido(valor) {
  const base = String(valor ?? '')
    .toLowerCase()
    .slice(0, 2);
  return IDIOMAS.includes(base) ? base : null;
}

function escolher() {
  if (import.meta.env?.MODE === 'test') {
    return 'pt';
  }

  // No worker de parsing não há window nem localStorage: o parseClient
  // cria o worker com o idioma no nome (new Worker(url, { name })).
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return (typeof self !== 'undefined' && valido(self.name)) || 'pt';
  }

  let daUrl = null;
  try {
    daUrl = valido(new URLSearchParams(window.location.search).get('lang'));
  } catch {
    daUrl = null;
  }

  if (daUrl) {
    try {
      localStorage.setItem('c3d_idioma', daUrl);
    } catch {
      /* modo privado */
    }
    return daUrl;
  }

  let guardado = null;
  try {
    guardado = valido(localStorage.getItem('c3d_idioma'));
  } catch {
    /* modo privado */
  }

  return guardado ?? valido(navigator.language) ?? 'pt';
}

/** O idioma desta página: pt, en ou es. */
export const idioma = escolher();

/** O locale para números e datas (toLocaleString). */
export const locale = LOCALES[idioma];

/** O texto no idioma de quem lê, com ^1..^4 no lugar. */
export function t(texto, ...parametros) {
  let saida = idioma !== 'pt' ? (dicionarios[idioma]?.[texto] ?? texto) : texto;

  parametros.slice(0, 4).forEach((valor, i) => {
    // Função no replace: um $& no valor não vira padrão.
    saida = saida.replace(`^${i + 1}`, () => String(valor));
  });

  return saida;
}

/** Traduz os elementos marcados com data-t* dentro de `raiz`. */
export function aplicarNoDom(raiz = document) {
  const marcas = [
    [
      'data-t',
      (el, v) => {
        el.textContent = v;
      },
    ],
    [
      'data-t-html',
      (el, v) => {
        el.innerHTML = v;
      },
    ],
    [
      'data-t-title',
      (el, v) => {
        el.setAttribute('title', v);
      },
    ],
    [
      'data-t-aria',
      (el, v) => {
        el.setAttribute('aria-label', v);
      },
    ],
    [
      'data-t-placeholder',
      (el, v) => {
        el.setAttribute('placeholder', v);
      },
    ],
  ];

  for (const [atributo, aplicar] of marcas) {
    raiz
      .querySelectorAll(`[${atributo}]`)
      .forEach((el) => aplicar(el, t(el.getAttribute(atributo))));
  }

  if (raiz === document) {
    document.documentElement.lang = locale;
  }
}
