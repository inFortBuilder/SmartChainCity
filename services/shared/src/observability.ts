import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { type FastifyInstance, type FastifyServerOptions, LogController } from 'fastify';

/**
 * Observabilidade comum dos serviços (E1.7, trilha de infra passo 6):
 * logs estruturados com o nome do serviço e o id da requisição, o id
 * devolvido em `x-request-id` (o gateway repassa aos serviços), e métricas
 * no formato do Prometheus em `GET /metrics`.
 */

/** Id que chega de fora só é aceito se for curto e sem caracteres que estraguem o log. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function requestIdFrom(req: Pick<IncomingMessage, 'headers'>): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export interface ServerOptionsInput {
  service: string;
  nodeEnv: string;
  /** Campos a esconder no log, além do token de acesso e do token de serviço. */
  redact?: string[];
  logLevel?: string;
}

/** Opções do Fastify: log JSON com `service` e `requestId`; sem log nos testes. */
export function serverOptions({ service, nodeEnv, redact = [], logLevel }: ServerOptionsInput): FastifyServerOptions {
  return {
    logger:
      nodeEnv === 'test'
        ? false
        : {
            level: logLevel ?? 'info',
            base: { service },
            redact: ['req.headers.authorization', 'req.headers["x-service-token"]', ...redact],
          },
    // O Fastify sempre chama genReqId; ele aceita o id de fora quando é válido.
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    genReqId: requestIdFrom,
  };
}

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

interface Series {
  count: number;
  sum: number;
  buckets: number[];
}

/** Métricas HTTP em memória, por serviço. Cada processo expõe as suas; o Prometheus soma. */
export class HttpMetrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Series>();
  private inFlight = 0;
  private readonly startedAt = Date.now();

  constructor(readonly service: string) {}

  start() {
    this.inFlight++;
  }

  observe(method: string, route: string, status: number, seconds: number) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const key = labels({ method, route, status: String(status) });
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    const dkey = labels({ method, route });
    const series = this.durations.get(dkey) ?? { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
    series.count++;
    series.sum += seconds;
    BUCKETS.forEach((le, k) => {
      if (seconds <= le) series.buckets[k]!++;
    });
    this.durations.set(dkey, series);
  }

  /** Texto no formato de exposição do Prometheus (versão 0.0.4). */
  render(): string {
    const svc = `service="${escape(this.service)}"`;
    const out: string[] = [];
    out.push('# HELP http_requests_total Requisições HTTP atendidas, por rota e status.');
    out.push('# TYPE http_requests_total counter');
    for (const [key, n] of this.requests) out.push(`http_requests_total{${svc},${key}} ${n}`);

    out.push('# HELP http_request_duration_seconds Tempo de resposta, por rota.');
    out.push('# TYPE http_request_duration_seconds histogram');
    for (const [key, s] of this.durations) {
      BUCKETS.forEach((le, k) => out.push(`http_request_duration_seconds_bucket{${svc},${key},le="${le}"} ${s.buckets[k]}`));
      out.push(`http_request_duration_seconds_bucket{${svc},${key},le="+Inf"} ${s.count}`);
      out.push(`http_request_duration_seconds_sum{${svc},${key}} ${s.sum}`);
      out.push(`http_request_duration_seconds_count{${svc},${key}} ${s.count}`);
    }

    const mem = process.memoryUsage();
    out.push('# HELP http_requests_in_flight Requisições em andamento.');
    out.push('# TYPE http_requests_in_flight gauge');
    out.push(`http_requests_in_flight{${svc}} ${this.inFlight}`);
    out.push('# HELP process_uptime_seconds Tempo no ar do processo.');
    out.push('# TYPE process_uptime_seconds gauge');
    out.push(`process_uptime_seconds{${svc}} ${(Date.now() - this.startedAt) / 1000}`);
    out.push('# HELP process_resident_memory_bytes Memória residente.');
    out.push('# TYPE process_resident_memory_bytes gauge');
    out.push(`process_resident_memory_bytes{${svc}} ${mem.rss}`);
    out.push('# HELP nodejs_heap_used_bytes Heap do V8 em uso.');
    out.push('# TYPE nodejs_heap_used_bytes gauge');
    out.push(`nodejs_heap_used_bytes{${svc}} ${mem.heapUsed}`);
    return `${out.join('\n')}\n`;
  }
}

const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labels = (l: Record<string, string>) =>
  Object.entries(l)
    .map(([k, v]) => `${k}="${escape(v)}"`)
    .join(',');

const sameToken = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export interface ObserveOptions {
  service: string;
  nodeEnv: string;
  /**
   * Token que o Prometheus manda em `Authorization: Bearer`. Sem ele, /metrics
   * fica aberto fora de produção e desligado (404) em produção.
   */
  metricsToken?: string | undefined;
}

/** Liga métricas e o `x-request-id` na resposta. Chamar logo depois de criar o app. */
export function observe(app: FastifyInstance, { service, nodeEnv, metricsToken }: ObserveOptions): HttpMetrics {
  const metrics = new HttpMetrics(service);
  const started = new WeakMap<object, bigint>();

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    if (request.url === '/metrics') return;
    metrics.start();
    started.set(request, process.hrtime.bigint());
  });

  app.addHook('onResponse', async (request, reply) => {
    const t0 = started.get(request);
    if (t0 === undefined) return;
    // Rota do registro (/v1/avatars/:id), não a URL: senão cada id vira uma série.
    const route = request.routeOptions.url ?? 'sem_rota';
    metrics.observe(request.method, route, reply.statusCode, Number(process.hrtime.bigint() - t0) / 1e9);
  });

  app.get('/metrics', { config: { rateLimit: false }, logLevel: 'warn' }, async (request, reply) => {
    if (metricsToken) {
      const auth = request.headers.authorization ?? '';
      const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!sameToken(given, metricsToken)) {
        return reply.status(401).send({ error: { code: 'unauthorized', message: 'Token de métricas inválido.' } });
      }
    } else if (nodeEnv === 'production') {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
    }
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render());
  });

  return metrics;
}
