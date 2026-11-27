# services

Serviços de backend em TypeScript (workspace pnpm).

| Serviço | Pacote | Responsabilidade |
|---------|--------|------------------|
| [gateway](gateway/README.md) | `@scc/gateway` | Autenticação (SIWE/e-mail), JWT, rate limit |
| [game-core](game-core/README.md) | `@scc/game-core` | Avatares e atributos (pronto: queda por job, até 3 por conta), turnos (pronto: commit-reveal, pago pelo ledger), negócios, fazenda, pets |
| [economy](economy/README.md) | `@scc/economy` | Ledger THALER (pronto: dupla entrada, idempotência, extrato), impostos, câmbio, saques |
| [world](world/README.md) | `@scc/world` | Lotes (pronto: situação, dono e venda primária paga pelo ledger), imóveis, cotações assinadas |
| [realtime](realtime/README.md) | `@scc/realtime` | Colyseus (pronto: salas por bairro, presença, chat moderado, eventos da Prefeitura) |
| [chain-indexer](chain-indexer/README.md) | `@scc/chain-indexer` | Eventos on-chain (pronto: confirmações, reorg, posse de lotes, avatares e caixas); depósitos e vouchers |
| [shared](shared/README.md) | `@scc/shared` | Tipos, erros, validação do token de acesso (`verifyAccessToken`) e da chave de serviço (`requireServiceToken`) |

Cada serviço tem o seu `openapi.yaml` (OpenAPI 3.1) ao lado do README. O teste [shared/test/openapi.test.ts](shared/test/openapi.test.ts) confere que as rotas do código e as do arquivo são as mesmas: rota nova pede a sua entrada no `openapi.yaml`.

Caminho de desenvolvimento: [docs/desenvolvimento/trilha-backend.md](../docs/desenvolvimento/trilha-backend.md)
