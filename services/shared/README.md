# services/shared

Código compartilhado entre serviços: tipos de domínio, erros, logger, configuração e cliente das ABIs.

- Observabilidade: `serverOptions` (log JSON com `service` e `requestId`) e `observe` (`x-request-id` e `GET /metrics`) e `forwardRequestId` (repassa o id ao chamar outro serviço); ver [infra/observability](../../infra/observability/README.md)
- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md)
- Modelo de dados e API: [docs/06](../../docs/06-modelo-dados-api.md)
