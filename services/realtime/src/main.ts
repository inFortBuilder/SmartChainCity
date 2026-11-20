import { configSchema, startRealtime } from './server.js';

const config = configSchema.parse(process.env);

// Log JSON por linha, no mesmo formato dos outros serviços (infra/observability).
const log = (event: string, data: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: 30, time: Date.now(), service: 'realtime', msg: event, ...data }));

const server = await startRealtime(config, log);
log('Server listening', { url: `ws://${config.HOST}:${server.port}`, max_clients: config.MAX_CLIENTS });

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
