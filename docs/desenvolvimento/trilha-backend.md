# Trilha — Backend (serviços)

Pasta: [`services/`](../../services/README.md) · Especificação: [doc 05 §4](../05-arquitetura-tecnica.md#4-backend), [doc 06](../06-modelo-dados-api.md)

## Caminho de desenvolvimento

| Passo | Etapa | Serviço | O que fazer | Pronto quando |
|------:|-------|---------|-------------|---------------|
| 1 | 0 | todos | Workspace pnpm, pacote `@scc/shared` (tipos, erros, logger, config), modelo de serviço com healthcheck | `pnpm dev` sobe um serviço de exemplo |
| 2 | 0 | — | Escolher ORM e framework (ADR), esquema inicial do [doc 06 §2](../06-modelo-dados-api.md#2-esquema-proposto-postgresql) | Migração roda no Postgres do Compose |
| 3 | 1 | gateway | JWT, rate limit, `openapi.yaml`, roteamento | Contrato publicado e gerando o cliente Unity |
| 4 | 1 | gateway (auth) | SIWE (`nonce` → `verify`), login por e-mail, vínculo de carteira | `GET /v1/me` autenticado |
| 5 | 1 | economy | Ledger de dupla entrada, contas `player/system/pool/burn`, extrato, idempotência | Invariante do ledger em teste de propriedade |
| 6 | 1 | game-core | Avatar, atributos, decaimento agendado | Atributos decaem por job |
| 7 | 1 | game-core | **Turno de trabalho**: validações, seed commit-reveal, job `shift.complete`, coleta | Turno de 6 h conclui sem cliente |
| 8 | 1 | game-core | Leitor do catálogo (webhook do Strapi → Redis) | Mudança no Strapi aparece sem redeploy |
| 9 | 2 | world | Grade, regiões, `GET /world/cells`, cotação assinada (EIP-712) com regras de bairro e cerco | Cotação aceita pelo `LandNFT` na testnet |
| 10 | 2 | world | Imóveis: obra, desgaste, renda, upgrade, regularização, utilidades | Fluxo de imóvel completo |
| 11 | 2 | economy | Impostos (IPTU, PT), aluguel, hotel; câmbio de teste | Cobrança agendada e auditável |
| 12 | 2 | game-core | Alimentação, hospital, farmácia, doenças | Fluxos do GDD §5 da fase 1 |
| 13 | 2 | chain-indexer | Leitura de eventos com confirmações, idempotência por `tx_hash + log_index`, reorg | Depósito na testnet credita THALER uma vez |
| 14 | 2 | realtime | Colyseus com salas por célula, presença, chat moderado | 100 clientes simulados por sala |
| 15 | 2 | game-core | Antifraude v1 (limite de avatares, fingerprint, velocidade) | Regras com métricas |
| 16 | 3 | economy | Vouchers de saque, limites, carência, spread, circuit breaker | Saque resgatado no `GameVault` |
| 17 | 3 | game-core | Pets, escola, lazer, fazenda, veículos, corridas, eventos semanais | Épicos E3.x |
| 18 | 3 | market | Listagens off-chain, combo lote + imóvel | Venda em combo atômica |

## Estrutura de cada serviço

```
services/<nome>/
├─ src/
│  ├─ api/        ← rotas, DTOs, validação
│  ├─ domain/     ← regras puras (testes unitários aqui)
│  ├─ infra/      ← repositórios, fila, chain, cache
│  ├─ jobs/       ← processadores BullMQ
│  └─ main.ts
├─ test/
├─ .env.example
├─ Dockerfile
└─ package.json   ← nome @scc/<nome>
```

## Filas e jobs

| Fila | Job | Agendamento |
|------|-----|-------------|
| `shifts` | `shift.complete` | No fim de cada turno |
| `attributes` | `attributes.decay` | A cada 15 min por avatar ativo (em lote) |
| `world` | `season.rotate` | A cada 7 dias |
| `economy` | `tax.charge` (IPTU, PT, IPVA) | Diário (processa os vencimentos) |
| `economy` | `fx.update` | Diário (TWAP 24 h) |
| `events` | `weekly_event.start` | Semanal |
| `chain` | `confirmations.check` | A cada bloco |
