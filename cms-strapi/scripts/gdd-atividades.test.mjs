import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseActivities } from './gdd-atividades.mjs';

// Trecho inventado no formato que o PDF do GDD vira em texto: sumário com
// página, item quebrado em duas linhas, rodapé no meio e o mesmo nome em dois grupos.
const texto = `
4.5 Atividades extras 112
4.5.1 Transportes 112
 - Pousar na Terra (+ 1 felicidade, -1 energia)
 4.5 Atividades extras
 4.5.1 Transportes
 - Dirigir o transporte (-energia, + felicidade)
 - Ir aos lugares (Ginásio, escola, trabalho) (-energia)
 111
 Este documento é de propriedade da FGV Jr. e de seu cliente, sendo vetadas quaisquer reproduções sem autorização expressa.

=== página 112 ===

 4.5.9 Academia
 - Tomar banho (+energia, +felicidade)
 - Fazer exercícios de musculação (+felicidade, -energia, +
 saúde)
 4.5.12 Higiene
 - Tomar banho (+saúde, +higiene)
 - Comer (+alimentação)
 5. Eventos semanais das profissões
 - Feira orgânica
`;

test('lê a seção 4.5, não o sumário nem o capítulo seguinte', () => {
  const list = parseActivities(texto);
  assert.deepEqual(
    list.map((a) => a.code),
    [
      'transportes_dirigir_o_transporte',
      'transportes_ir_aos_lugares_ginasio_escola_trabalho',
      'academia_tomar_banho', 'academia_fazer_exercicios_de_musculacao', 'higiene_tomar_banho', 'higiene_comer'],
  );
});

test('direção de cada efeito, inclusive quebrada entre linhas', () => {
  const byCode = Object.fromEntries(parseActivities(texto).map((a) => [a.code, a]));
  assert.deepEqual(byCode.transportes_dirigir_o_transporte, {
    code: 'transportes_dirigir_o_transporte',
    label: 'Dirigir o transporte',
    group: 'transportes',
    energy: -1,
    health: 0,
    happiness: 1,
    food: 0,
    hygiene: 0,
  });
  assert.equal(byCode.transportes_ir_aos_lugares_ginasio_escola_trabalho.label, 'Ir aos lugares (Ginásio, escola, trabalho)');
  assert.equal(byCode.transportes_ir_aos_lugares_ginasio_escola_trabalho.energy, -1);
  assert.equal(byCode.academia_fazer_exercicios_de_musculacao.health, 1);
  assert.equal(byCode.higiene_tomar_banho.hygiene, 1);
  assert.equal(byCode.higiene_comer.food, 1);
});
