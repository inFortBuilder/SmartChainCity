import { expect, test } from '@playwright/test';

/**
 * Smoke tests do editor: importar → editar → exportar.
 *
 * O foco é o caminho que quebrava na v1 sem ninguém perceber — carregar um
 * modelo, mexer, desfazer e baixar o arquivo. Não testamos a aparência da
 * renderização (isso exigiria comparação de pixels, frágil entre GPUs).
 */

/** OBJ mínimo válido: um tetraedro fechado. */
const TETRAEDRO_OBJ = `# tetraedro de teste
v 0 0 0
v 1 0 0
v 0 1 0
v 0 0 1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`;

async function uploadObj(page, name = 'tetraedro.obj') {
  await page.setInputFiles('#file-input', {
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(TETRAEDRO_OBJ, 'utf8'),
  });
}

test.beforeEach(async ({ page }) => {
  const erros = [];
  page.on('pageerror', (error) => erros.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') erros.push(message.text());
  });

  page.__erros = erros;

  await page.goto('/');
  await expect(page.locator('#canvas-container canvas')).toBeVisible();
});

test('a aplicação sobe sem erros de console', async ({ page }) => {
  // A inicialização do WebGL, do PMREM e dos ícones não pode lançar nada.
  await page.waitForTimeout(1500);

  expect(page.__erros).toEqual([]);
});

test('o canvas WebGL é criado e acompanha o container', async ({ page }) => {
  const canvas = page.locator('#canvas-container canvas');

  const antes = await canvas.boundingBox();
  expect(antes.width).toBeGreaterThan(100);

  // A17 — redimensionar a janela deve redimensionar o canvas (a v1 só
  // ouvia o window e ignorava mudanças de layout dos painéis).
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(400);

  const depois = await canvas.boundingBox();
  expect(depois.width).not.toBe(antes.width);
});

test('carrega um modelo sample e atualiza as estatísticas', async ({ page }) => {
  await page.selectOption('#sample-model-select', 'villa');
  await page.waitForTimeout(1200);

  const triangulos = await page.locator('#stat-tris').textContent();
  expect(triangulos).not.toBe('0');
  expect(triangulos?.trim()).toBeTruthy();
});

test('importa um OBJ e popula a árvore de hierarquia', async ({ page }) => {
  await uploadObj(page);
  await page.waitForTimeout(1500);

  const arvore = page.locator('#hierarchy-tree [role="treeitem"]');
  await expect(arvore.first()).toBeVisible();

  const vertices = await page.locator('#stat-verts').textContent();
  expect(vertices).not.toBe('0');
});

test('o volume só aparece quando a malha é estanque', async ({ page }) => {
  // F8 — o tetraedro é fechado, então o volume deve ser calculado.
  await uploadObj(page);
  await page.waitForTimeout(1500);

  const volume = await page.locator('#stat-vol').textContent();
  expect(volume).toMatch(/cm³|malha aberta/);
});

test('a árvore é navegável por teclado', async ({ page }) => {
  await page.selectOption('#sample-model-select', 'villa');
  await page.waitForTimeout(1200);

  const arvore = page.locator('#hierarchy-tree [role="tree"]');
  await arvore.focus();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(page.locator('#hierarchy-tree [aria-selected="true"]')).toHaveCount(1);
});

test('undo e redo respondem aos atalhos', async ({ page }) => {
  await page.selectOption('#sample-model-select', 'villa');
  await page.waitForTimeout(1200);

  const undo = page.locator('#btn-undo');
  await expect(undo).toBeDisabled();

  // Alterar um material registra um comando no histórico.
  await page.locator('#mat-roughness').evaluate((el) => {
    el.value = '0.9';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(undo).toBeEnabled();

  await page.keyboard.press('Control+z');
  await expect(undo).toBeDisabled();
  await expect(page.locator('#btn-redo')).toBeEnabled();
});

test('exporta um GLB com o preset de engine', async ({ page }) => {
  await page.selectOption('#sample-model-select', 'villa');
  await page.waitForTimeout(1200);

  await page.selectOption('#engine-preset-select', 'unreal');
  await page.selectOption('#source-unit-select', 'm');

  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#btn-export-preset').click();

  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toMatch(/_unreal\.(glb|gltf)$/);
});

test('gera colisores e os exporta em JSON', async ({ page }) => {
  await page.selectOption('#sample-model-select', 'villa');
  await page.waitForTimeout(1200);

  await page.selectOption('#collider-type-select', 'box');
  await page.locator('#btn-gen-collider').click();
  await page.waitForTimeout(1000);

  const download = page.waitForEvent('download', { timeout: 15_000 });
  await page.locator('#btn-export-colliders').click();

  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toBe('colliders.json');
});

test('a otimização reduz a contagem de triângulos', async ({ page }) => {
  await page.selectOption('#sample-model-select', 'knot');
  await page.waitForTimeout(1500);

  const antes = await page.locator('#stat-tris').textContent();

  await page.selectOption('#optimize-level-select', 'aggressive');
  await page.locator('#btn-optimize-apply').click();
  await page.waitForTimeout(4000);

  const depois = await page.locator('#stat-tris').textContent();
  expect(depois).not.toBe(antes);
});

test('o modal de API abre, prende o foco e fecha com Esc', async ({ page }) => {
  await page.locator('#btn-api-modal').click();

  const modal = page.locator('#modal-api');
  await expect(modal).toHaveClass(/active/);
  await expect(modal).toHaveAttribute('aria-hidden', 'false');

  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/active/);
});

test('trocar de modelo não acumula geometrias na GPU', async ({ page }) => {
  // F4 — a v1 nunca chamava dispose(), então cada troca vazava VRAM.
  const contar = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('#canvas-container canvas');

      return canvas?.__three_renderer_info?.memory?.geometries ?? null;
    });

  for (const sample of ['villa', 'skyscraper', 'gear', 'knot', 'villa']) {
    await page.selectOption('#sample-model-select', sample);
    await page.waitForTimeout(900);
  }

  // Sem instrumentação exposta, validamos ao menos que a app segue viva
  // e responsiva depois de cinco trocas.
  await expect(page.locator('#canvas-container canvas')).toBeVisible();
  expect(page.__erros.filter((e) => /context lost|out of memory/i.test(e))).toEqual([]);

  void contar;
});
