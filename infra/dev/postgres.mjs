/**
 * Postgres local sem Docker e sem administrador: `pnpm db:up`.
 * Dados em .local/postgres. Usa a mesma URL do Compose, então os dois se trocam.
 * Só para desenvolvimento: a senha é pública.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

const dir = resolve(import.meta.dirname, '../../.local/postgres');
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'scc',
  password: 'scc_dev',
  port: 5433,
  persistent: true,
  onLog: () => {},
});

const fresh = !existsSync(join(dir, 'PG_VERSION'));
if (fresh) await pg.initialise();
try {
  await pg.start();
} catch {
  console.error('O Postgres não subiu. A porta 5433 já está em uso? Talvez ele já esteja no ar.');
  process.exit(1);
}
if (fresh) await pg.createDatabase('scc');

console.log('Postgres no ar: postgresql://scc:scc_dev@127.0.0.1:5433/scc (Ctrl+C para parar)');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
