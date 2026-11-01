import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryAuthStore } from './infra/memory-store.js';

const config = loadConfig();

// Accounts would vanish on every restart, and nonces would not be shared between instances.
if (config.NODE_ENV === 'production') {
  throw new Error('O gateway ainda não tem armazenamento persistente: não suba em produção.');
}

const app = await buildApp(config, new MemoryAuthStore());
await app.listen({ port: config.PORT, host: config.HOST });
