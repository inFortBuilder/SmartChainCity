import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseProfessions } from './gdd-profissoes.mjs';

// Trecho inventado no formato que o PDF do GDD vira em texto, com as armadilhas
// reais: sumário com página, ordem trocada, cabeçalho quebrado, ponto no lugar
// de vírgula, "- energia" sem número, rodapé e número de página no meio.
const texto = `
4.1 Comuns 87
4.1.1 Pedreiro (100 tokens, 265 minutos) 87
4.1 Comuns
 4.1.1 Pedreiro (100 tokens, 30 minutos)
 - Pegar as ferramentas (-1 energia, 10
 minutos)
 - Levantar a parede (-2 energia, +3 felicidade, 15 minutos. 60 tokens)
 87
 Este documento é de propriedade da FGV Jr. e de seu cliente, sendo vetadas quaisquer reproduções sem autorização expressa.

=== página 88 ===

 - Receber o pagamento (+2 felicidade, 5 minutos, 40 tokens)
 - Voltar para casa (- energia)
 4.2 Raro
 4.2.11 Garçom (20 minutos, 150
 tokens)
 - Servir a mesa (-1 energia, 20 minutos, 150 tokens)
 4.5 Atividades extras
 4.5.1 Transportes
`;

test('lê o capítulo, não o sumário, com as variações do PDF', () => {
  const [pedreiro, garcom, ...resto] = parseProfessions(texto);
  assert.equal(resto.length, 0);
  assert.deepEqual(
    { code: pedreiro.code, rarity: pedreiro.rarity, tokens: pedreiro.tokens, minutes: pedreiro.minutes, tasks: pedreiro.tasks.length },
    { code: 'pedreiro', rarity: 'common', tokens: 100, minutes: 30, tasks: 4 },
  );
  assert.deepEqual(pedreiro.totals, { energy: -4, happiness: 5, minutes: 30, tokens: 100 });
  assert.equal(pedreiro.conferir, undefined);
  assert.deepEqual({ code: garcom.code, rarity: garcom.rarity, tokens: garcom.tokens, minutes: garcom.minutes }, { code: 'garcom', rarity: 'rare', tokens: 150, minutes: 20 });
});

test('quando as tarefas não fecham com o cabeçalho, anota para conferir', () => {
  const [p] = parseProfessions(texto.replace('30 minutos)', '45 minutos)'));
  assert.deepEqual(p.conferir, ['tarefas somam 30 minutos; o cabeçalho diz 45']);
});
