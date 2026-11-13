import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL.');

const pool = new Pool({ connectionString: url });
// Tabela de controle própria (drizzle.__economy_migrations): não mistura com as
// migrações do gateway. Fica fora do esquema economy, que a migração 0000 cria.
await migrate(drizzle(pool), {
  migrationsFolder: new URL('../../../drizzle', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  migrationsTable: '__economy_migrations',
});
await pool.end();
console.log('Migrações do economy aplicadas.');
