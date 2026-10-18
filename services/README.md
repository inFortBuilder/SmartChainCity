# services

Serviços de backend em TypeScript (workspace pnpm).

| Serviço | Pacote | Responsabilidade |
|---------|--------|------------------|
| [gateway](gateway/README.md) | `@scc/gateway` | Autenticação (SIWE/e-mail), JWT, rate limit, OpenAPI |
| [game-core](game-core/README.md) | `@scc/game-core` | Avatares, atributos, turnos, negócios, fazenda, pets |
| [economy](economy/README.md) | `@scc/economy` | Ledger THALER, impostos, câmbio, saques |
| [world](world/README.md) | `@scc/world` | Grade, lotes, imóveis, cotações assinadas |
| [realtime](realtime/README.md) | `@scc/realtime` | Colyseus: presença, chat, eventos |
| [chain-indexer](chain-indexer/README.md) | `@scc/chain-indexer` | Eventos on-chain, depósitos, vouchers |
| [shared](shared/README.md) | `@scc/shared` | Tipos, erros, logger, config |

Caminho de desenvolvimento: [docs/desenvolvimento/trilha-backend.md](../docs/desenvolvimento/trilha-backend.md)
