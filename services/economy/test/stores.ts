import { Pool } from 'pg';

import type { LedgerStore } from '../src/domain/ledger.js';
import { PostgresLedgerStore } from '../src/infra/db/postgres-store.js';
import { MemoryLedgerStore } from '../src/infra/memory-store.js';

/** Postgres só roda com TEST_DATABASE_URL (no CI, o serviço postgres do job). */
const url = process.env.TEST_DATABASE_URL;
export const pool = url ? new Pool({ connectionString: url, max: 20 }) : null;

export const stores: [string, () => LedgerStore, boolean][] = [
  ['memória', () => new MemoryLedgerStore(), true],
  ['postgres', () => new PostgresLedgerStore(pool!), pool !== null],
];
