/**
 * Lê o capítulo 4 do GDD original ("Atividades dos minigames das profissões")
 * e gera o catálogo de profissões: as 44 profissões com raridade, ganho do
 * dia em tokens (THALER), duração e tarefas (energia, felicidade, minutos e
 * tokens de cada uma). É o seed dos tipos `job` e `job_task` do Strapi
 * (trilha do CMS, passo 5) e o que o game-core lê enquanto o Strapi não existe.
 *
 *   node cms-strapi/scripts/gdd-profissoes.mjs gdd.txt cms-strapi/seed/profissoes.json
 *
 * O texto vem de gdd-texto.mjs. O leitor corrige o que o PDF bagunça: ordem
 * de tokens e minutos trocada, cabeçalho quebrado em duas linhas, "- energia"
 * sem número (vale 1) e nomes com erro de digitação.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const RARITY = { 1: 'common', 2: 'rare', 3: 'epic', 4: 'legendary' };

/** Nome no GDD → código do catálogo (o mesmo do game-core e do Strapi). */
const CODES = {
  pedreiro: 'pedreiro',
  alfaiate: 'alfaiate',
  padeiro: 'padeiro',
  agricultor: 'agricultor',
  enfermeira: 'enfermeira',
  professor: 'professor',
  bombeiro: 'bombeiro',
  motorista: 'motorista',
  tosador: 'tosador',
  'corretor de imoveis': 'corretor_imoveis',
  recepcionista: 'recepcionista',
  construtor: 'construtor',
  modelista: 'modelista',
  confeitero: 'confeiteiro',
  confeiteiro: 'confeiteiro',
  pescador: 'pescador',
  dentista: 'dentista',
  'orientador escolar': 'orientador_escolar',
  policial: 'policial',
  mecanico: 'mecanico',
  'pet sitter': 'pet_sitter',
  'consultor de imoveis': 'consultor_imoveis',
  garcom: 'garcom',
  arquiteto: 'arquiteto',
  'designer de acessorios': 'designer_acessorios',
  cozinheiro: 'cozinheiro',
  fazendeiro: 'fazendeiro',
  farmaceutico: 'farmaceutico',
  'coordenador escolar': 'coordenador_escolar',
  perito: 'perito',
  piloto: 'piloto',
  adestrador: 'adestrador',
  'administativo de condominio': 'administrador_condominio',
  'administrador de condominio': 'administrador_condominio',
  concierge: 'concierge',
  veterinario: 'veterinario',
  incorporador: 'incorporador',
  hoteleiro: 'hoteleiro',
  'engenheiro civil': 'engenheiro_civil',
  estilista: 'estilista',
  chef: 'chef',
  agronomo: 'agronomo',
  medico: 'medico',
  diretor: 'diretor',
  delegado: 'delegado',
  astronauta: 'astronauta',
};

/** Nome de exibição corrigido (o GDD tem erros de digitação em dois). */
const LABELS = { confeiteiro: 'Confeiteiro', administrador_condominio: 'Administrador de Condomínio' };

const fold = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Tira números de página, rodapé e marcas de página que o PDF intercala. */
function cleanLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l) && !/^Este documento é de propriedade/.test(l) && !/^=== página/.test(l));
}

/** Lê "(-1 energia, +2 felicidade, 30 minutos, 100 tokens)" em números. */
function readEffects(inside) {
  const out = { energy: 0, happiness: 0, minutes: 0, tokens: 0 };
  // O GDD separa com vírgula, mas às vezes com ponto ("40 minutos. 35 tokens").
  for (const part of inside.split(/[,;]|\.\s/)) {
    const p = part.replace(/\s+/g, ' ').trim();
    let m;
    if ((m = /([+-])\s*(\d+)?\s*energia/i.exec(p))) out.energy += (m[1] === '-' ? -1 : 1) * Number(m[2] ?? 1);
    else if ((m = /([+-])\s*(\d+)?\s*felicidade/i.exec(p))) out.happiness += (m[1] === '-' ? -1 : 1) * Number(m[2] ?? 1);
    else if ((m = /(\d+)\s*minutos?/i.exec(p))) out.minutes += Number(m[1]);
    else if ((m = /\+?\s*(\d+)\s*tokens?/i.exec(p))) out.tokens += Number(m[1]);
  }
  return out;
}

export function parseProfessions(text) {
  const lines = cleanLines(text);
  // O sumário também tem "4.1 Comuns 87" (com a página); o capítulo é a linha sem número.
  const start = lines.findIndex((l) => /^4\.1 Comuns$/.test(l));
  const end = lines.findIndex((l, k) => k > start && /^4\.5 Atividades extras$/.test(l));
  if (start < 0 || end < 0) throw new Error('Capítulo 4 não encontrado no texto.');

  const professions = [];
  let current = null;
  let task = null;
  const flushTask = () => {
    if (!task || !current) return;
    const open = task.indexOf('(');
    const name = (open >= 0 ? task.slice(0, open) : task).replace(/\s+/g, ' ').trim();
    const inside = open >= 0 ? task.slice(open + 1, task.lastIndexOf(')') > open ? task.lastIndexOf(')') : undefined) : '';
    current.tasks.push({ name, ...readEffects(inside) });
    task = null;
  };

  for (let k = start + 1; k < end; k++) {
    let line = lines[k];
    if (/^4\.[1-4] /.test(line) && !/^4\.[1-4]\.\d/.test(line)) continue; // "4.2 Raro"
    const head = /^4\.([1-4])\.(\d+)\s*(.+)$/.exec(line);
    if (head) {
      flushTask();
      // Cabeçalho quebrado: junta até fechar o parêntese.
      while (!line.includes(')') && k + 1 < end) line += ` ${lines[++k]}`;
      const [, rarityDigit, , rest] = /^4\.([1-4])\.(\d+)\s*(.+)$/.exec(line);
      const open = rest.indexOf('(');
      const gddName = rest.slice(0, open).trim();
      const inside = rest.slice(open + 1, rest.indexOf(')'));
      const code = CODES[fold(gddName)];
      if (!code) throw new Error(`Profissão sem código: "${gddName}"`);
      const { minutes, tokens } = readEffects(inside);
      current = {
        code,
        label: LABELS[code] ?? gddName.replace(/\s+/g, ' '),
        rarity: RARITY[rarityDigit],
        tokens,
        minutes,
        tasks: [],
      };
      professions.push(current);
      continue;
    }
    if (line.startsWith('- ')) {
      flushTask();
      task = line.slice(2);
    } else if (task !== null) {
      task += ` ${line}`;
    }
  }
  flushTask();

  // Totais das tarefas, para conferir com o cabeçalho e para o jogo usar.
  for (const p of professions) {
    p.totals = p.tasks.reduce(
      (t, x) => ({
        energy: t.energy + x.energy,
        happiness: t.happiness + x.happiness,
        minutes: t.minutes + x.minutes,
        tokens: t.tokens + x.tokens,
      }),
      { energy: 0, happiness: 0, minutes: 0, tokens: 0 },
    );
    // O cabeçalho é o valor oficial; a diferença fica anotada para o game designer revisar.
    const notes = [];
    if (p.totals.tokens !== p.tokens) notes.push(`tarefas somam ${p.totals.tokens} tokens; o cabeçalho diz ${p.tokens}`);
    if (p.totals.minutes !== p.minutes) notes.push(`tarefas somam ${p.totals.minutes} minutos; o cabeçalho diz ${p.minutes}`);
    if (notes.length) p.conferir = notes;
  }
  return professions;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}`) {
  const [input, output] = process.argv.slice(2);
  const professions = parseProfessions(readFileSync(input, 'utf8'));
  const catalog = {
    fonte: 'GDD original (FGV Jr.), capítulo 4 — Atividades dos minigames das profissões',
    gerado_por: 'cms-strapi/scripts/gdd-profissoes.mjs',
    unidades: { tokens: 'THALER por dia de trabalho', minutos: 'duração do minigame' },
    profissoes: professions,
  };
  writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`);
  const by = professions.reduce((m, p) => ({ ...m, [p.rarity]: (m[p.rarity] ?? 0) + 1 }), {});
  console.log(`${professions.length} profissões`, by);
}
