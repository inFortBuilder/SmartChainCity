/**
 * Testa os papéis do admin (src/papeis.ts) contra o Strapi no ar:
 *
 *   npm run develop          (em outro terminal)
 *   npm run test:papeis
 *
 * Cria um usuário temporário por papel, com senha aleatória que só existe
 * na memória deste script, e um alimento de teste. Entra pelo /admin/login
 * como cada um e confere o que pode e o que não pode. No fim apaga tudo,
 * mesmo se algo falhar. Não toca nos itens do catálogo.
 */
// CommonJS: a build ES do @strapi/strapi não carrega no Node (importa o lodash por nome).
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const BASE = process.env.STRAPI_URL ?? 'http://127.0.0.1:1337';
const FOOD = 'api::food.food';
const CM = `${BASE}/content-manager/collection-types/${FOOD}`;
const CODE = `teste_papeis_${Date.now()}`;

async function http(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`  ok    ${name}`);
  } catch (error) {
    results.push(`  FALHA ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const app = await createStrapi(await compileStrapi()).load();
  const users = [];
  let docId = null;
  try {
    const login = {};
    for (const code of ['scc-game-designer', 'scc-conteudo', 'scc-leitura']) {
      const role = await app.service('admin::role').findOne({ code });
      assert.ok(role, `papel ${code} não existe; o Strapi rodou o bootstrap?`);
      const email = `${code}-${Date.now()}@papeis.test`;
      const password = `Aa1!${randomBytes(18).toString('base64url')}`;
      const user = await app.service('admin::user').create({
        email,
        firstname: 'Teste',
        lastname: code,
        password,
        isActive: true,
        registrationToken: null,
        roles: [role.id],
      });
      users.push(user.id);
      const r = await http('POST', `${BASE}/admin/login`, null, { email, password });
      assert.equal(r.status, 200, `login de ${code}: ${r.status}`);
      login[code] = r.body.data.token;
    }
    const designer = login['scc-game-designer'];
    const conteudo = login['scc-conteudo'];
    const leitura = login['scc-leitura'];

    results.push('Game designer');
    await check('cria um alimento', async () => {
      const r = await http('POST', CM, designer, { code: CODE, label: 'Teste', group: 'fruta', energy: 1, health: 1, pack: 1, price: 10 });
      assert.equal(r.status, 201, `status ${r.status}`);
      docId = r.body.data.documentId;
    });
    await check('edita o balanceamento (preço)', async () => {
      const r = await http('PUT', `${CM}/${docId}`, designer, { price: 20 });
      assert.equal(r.status, 200, `status ${r.status}`);
      assert.equal(r.body.data.price, 20);
    });
    await check('publica', async () => {
      const r = await http('POST', `${CM}/${docId}/actions/publish`, designer, {});
      assert.equal(r.status, 200, `status ${r.status}`);
    });
    await check('não apaga', async () => {
      const r = await http('DELETE', `${CM}/${docId}`, designer);
      assert.equal(r.status, 403, `status ${r.status}`);
    });

    results.push('Conteúdo');
    await check('lê o catálogo', async () => {
      const r = await http('GET', `${CM}?page=1&pageSize=1`, conteudo);
      assert.equal(r.status, 200, `status ${r.status}`);
    });
    await check('edita o nome, mas o preço que mandou junto é ignorado', async () => {
      const r = await http('PUT', `${CM}/${docId}`, conteudo, { label: 'Teste renomeado', price: 999 });
      assert.equal(r.status, 200, `status ${r.status}`);
      const after = await http('GET', `${CM}/${docId}`, designer);
      assert.equal(after.body.data.label, 'Teste renomeado');
      assert.equal(after.body.data.price, 20);
    });
    await check('não publica', async () => {
      const r = await http('POST', `${CM}/${docId}/actions/publish`, conteudo, {});
      assert.equal(r.status, 403, `status ${r.status}`);
    });
    await check('não cria', async () => {
      const r = await http('POST', CM, conteudo, { code: `${CODE}_2`, label: 'X', group: 'fruta', energy: 0, health: 0, pack: 1 });
      assert.equal(r.status, 403, `status ${r.status}`);
    });
    await check('não vê multiplicadores para editar (sem campo de texto)', async () => {
      const r = await http('PUT', `${BASE}/content-manager/collection-types/api::attribute-multiplier.attribute-multiplier/x`, conteudo, { factor: 9 });
      assert.equal(r.status, 403, `status ${r.status}`);
    });

    results.push('Leitura');
    await check('lê o catálogo', async () => {
      const r = await http('GET', `${CM}?page=1&pageSize=1`, leitura);
      assert.equal(r.status, 200, `status ${r.status}`);
    });
    await check('não edita', async () => {
      const r = await http('PUT', `${CM}/${docId}`, leitura, { label: 'X' });
      assert.equal(r.status, 403, `status ${r.status}`);
    });
    await check('não publica', async () => {
      const r = await http('POST', `${CM}/${docId}/actions/publish`, leitura, {});
      assert.equal(r.status, 403, `status ${r.status}`);
    });
  } finally {
    if (docId) await app.documents(FOOD).delete({ documentId: docId });
    for (const id of users) await app.service('admin::user').deleteById(id);
    await app.destroy();
  }
  console.log(results.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
