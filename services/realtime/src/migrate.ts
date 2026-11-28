import { Pool } from 'pg';

import { migrateMutes } from './mute-store.js';

/** `pnpm db:migrate`: cria a tabela dos silenciamentos (o servidor também cria ao subir). */
const url = process.env.DATABASE_URL;
if (!url) {
  console.log('realtime: sem DATABASE_URL, os silenciamentos ficam na memória; nada a migrar.');
} else {
  const pool = new Pool({ connectionString: url, max: 1 });
  await migrateMutes(pool);
  await pool.end();
  console.log('Migrações do realtime aplicadas.');
}
