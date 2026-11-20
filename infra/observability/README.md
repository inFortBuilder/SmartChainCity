# Observabilidade (E1.7)

Logs, métricas e painel por serviço. Trilha de infra, passo 6 ([trilha-infra](../../docs/desenvolvimento/trilha-infra.md)).

## O que cada serviço já faz

O código fica em [`services/shared/src/observability.ts`](../../services/shared/src/observability.ts); gateway, economy, game-core e world usam.

| O quê | Como |
|---|---|
| **Log estruturado** | JSON (pino) com `service` e `requestId` em cada linha. Token de acesso, token de serviço e assinatura SIWE ficam escondidos. Nível em `LOG_LEVEL` |
| **Id da requisição** | Cada resposta traz `x-request-id`. Se a requisição já chega com um id válido (até 64 caracteres, letras, números e `._:-`), ele é mantido, para seguir a mesma requisição entre serviços; senão, o serviço gera um UUID. O game-core (ao pagar turno) e o world (ao cobrar lote) repassam o id ao economy, então o mesmo `requestId` aparece nos dois logs |
| **Métricas** | `GET /metrics` no formato do Prometheus: `http_requests_total` (por rota, método e status), `http_request_duration_seconds` (histograma), requisições em andamento, tempo no ar e memória. A rota é a registrada (`/v1/avatars/:id`), não a URL, para não criar uma série por id |
| **Proteção do /metrics** | Com `METRICS_TOKEN`, só quem manda `Authorization: Bearer <token>` lê. Sem token, fica aberto em desenvolvimento e desligado (404) em produção |

## Painel local (Prometheus + Grafana)

Com os serviços no ar (`pnpm dev` ou as configurações de preview), e o Docker Desktop rodando:

```bash
docker compose -f infra/observability/docker-compose.yml up -d
```

- Grafana: http://localhost:3001, painel **Smart Chain City — Serviços**. Entra sem login, só leitura (o admin padrão do Grafana é só local).
- Prometheus: http://localhost:9090, lê o `/metrics` das portas 8000, 8010, 8020 e 8030 do host a cada 5 s.

O painel mostra serviços no ar, requisições por segundo, erros 4xx e 5xx, latência p95 e memória por serviço, e as rotas mais chamadas. Para mudar o painel, edite [`grafana/gerar-painel.mjs`](grafana/gerar-painel.mjs) e rode `node infra/observability/grafana/gerar-painel.mjs`.

[`alertas.yml`](alertas.yml) traz três alertas de base: serviço fora por 1 minuto, mais de 2% de 5xx em 5 minutos e p95 acima de 1 s por 10 minutos. Os limites são de partida.

## Ainda falta

| Item | Por quê |
|---|---|
| **Sentry** | Adiado: o MVP roda só na máquina local, sem serviço pago. Os erros internos já saem no log JSON com o `requestId`. Quando houver conta, o lugar de ligar é o `setErrorHandler` de cada serviço, que já separa erro esperado (`AppError`) de erro interno |
| **Ambiente `dev` na AWS** | Adiado pelo mesmo motivo. CloudWatch e OpenTelemetry dependem do IaC (trilha de infra, passo 4) |
