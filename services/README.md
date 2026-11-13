# services

Serviços de backend em TypeScript (workspace pnpm).

| Serviço | Pacote | Responsabilidade |
|---------|--------|------------------|
| [gateway](gateway/README.md) | `@scc/gateway` | Autenticação (SIWE/e-mail), JWT, rate limit, OpenAPI |
| [game-core](game-core/README.md) | `@scc/game-core` | Avatares e atributos (pronto: queda por job, até 3 por conta), turnos (pronto: commit-reveal, pago pelo ledger), negócios, fazenda, pets |
| [economy](economy/README.md) | `@scc/economy` | Ledger THALER (pronto: dupla entrada, idempotência, extrato), impostos, câmbio, saques |
| [world](world/README.md) | `@scc/world` | Lotes (pronto: situação, dono e venda primária paga pelo ledger), imóveis, cotações assinadas |
| [realtime](realtime/README.md) | `@scc/realtime` | Colyseus: presença, chat, eventos |
| [chain-indexer](chain-indexer/README.md) | `@scc/chain-indexer` | Eventos on-chain, depósitos, vouchers |
| [shared](shared/README.md) | `@scc/shared` | Tipos, erros, validação do token de acesso (`verifyAccessToken`) e da chave de serviço (`requireServiceToken`) |

Caminho de desenvolvimento: [docs/desenvolvimento/trilha-backend.md](../docs/desenvolvimento/trilha-backend.md)
