# services/shared

Código compartilhado entre serviços: tipos de domínio, erros, logger, configuração e cliente das ABIs.

- Observabilidade: `serverOptions` (log JSON com `service` e `requestId`) e `observe` (`x-request-id` e `GET /metrics`) e `forwardRequestId` (repassa o id ao chamar outro serviço); ver [infra/observability](../../infra/observability/README.md)
- Jobs: `JobRunner` agenda os jobs periódicos do serviço. Com mais de uma instância, só uma roda cada passada (advisory lock do Postgres por serviço e job); `local: true` para cache do próprio processo. Métricas no /metrics: `job_runs_total{job,result}`, `job_last_success_timestamp_seconds` e `job_last_duration_seconds`. `stop()` espera a passada em andamento. Com PgBouncer, use o modo `session`.
- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md)
- Modelo de dados e API: [docs/06](../../docs/06-modelo-dados-api.md)
