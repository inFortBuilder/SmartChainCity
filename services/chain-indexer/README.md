# services/chain-indexer

Lê os eventos dos contratos na rede (anvil, BSC Testnet ou BSC). Espera as confirmações, trata reorganizações e espelha a posse dos NFTs para os outros serviços.

- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md) (passo 13)
- Contratos e eventos: [contracts](../../contracts/README.md), [doc 07 §4](../../docs/07-smart-contracts.md#4-eventos-que-o-indexer-consome)

## O que funciona hoje

| Regra | Como |
|---|---|
| Confirmações | Só lê blocos com `CONFIRMATIONS` blocos em cima: 15 na BSC (doc 05) e 0 ou 1 no anvil |
| Cada evento uma vez | Chave `chain_id + tx_hash + log_index`. Reler uma faixa não duplica nada |
| Atomicidade | Eventos novos, projeções e cursor são gravados na mesma transação |
| Reorganização | A cada rodada, confere se o bloco do cursor ainda tem o mesmo hash. Se mudou, volta `REORG_DEPTH` blocos (64), apaga os eventos depois disso, refaz as projeções a partir dos eventos que sobraram e lê de novo |
| Lotes | `Transfer` do `LandNFT`: dono de cada lote. O `tokenId` vira (cidade, lote) |
| Avatares | `Transfer` e `AvatarMinted` do `AvatarNFT`: dono, raridade e profissão |
| Caixas | `BoxOpened` e `AvatarRevealed` da `LuckyBox`: quem abriu, situação e avatar sorteado |
| Feed | `GET /internal/v1/chain/events?after=<id>` entrega os eventos confirmados, em ordem, para os outros serviços (com `x-service-token`) |

`LotSold` fica só no registro de eventos, porque a posse vem do `Transfer`.

**Testado no anvil em 2026-11-20, de ponta a ponta.** Com os contratos do `DeployLocal`:
- uma caixa foi aberta e sorteada, e o avatar 1 (Comum · enfermeira) apareceu com o jogador;
- um lote foi comprado com cotação assinada e depois transferido;
- só depois de 1 confirmação o espelho passou o lote para o novo dono.

## Rodar

Antes, suba o anvil e faça o deploy dos contratos ([contracts](../../contracts/README.md#rede-local-anvil)). Depois:

```bash
pnpm db:up
```

```bash
pnpm db:migrate
```

```bash
cp services/chain-indexer/.env.example services/chain-indexer/.env
```

```bash
pnpm --filter @scc/chain-indexer dev
```

O `.env.example` já aponta para o anvil e para `contracts/deployments/anvil.json`. Sem `RPC_URL`, o serviço só serve a API, e sem `DATABASE_URL` guarda tudo em memória.

Testes, com o banco só de testes. A rede de mentira dos testes simula confirmações, releitura e reorganização:

```bash
TEST_DATABASE_URL=postgresql://scc:scc_dev@127.0.0.1:5433/scc_test pnpm --filter @scc/chain-indexer test
```

## API

| Método | Rota | Quem chama | O que faz |
|---|---|---|---|
| GET | `/v1/chain/status` | público | Rede, confirmações, último bloco da rede e o lido, atraso, último erro, contratos |
| GET | `/v1/chain/lots/:tokenId` | público | Dono on-chain do lote, com cidade e número |
| GET | `/v1/chain/avatars/:tokenId` | público | Dono, raridade e profissão do avatar |
| GET | `/v1/chain/boxes/:requestId` | público | Caixa aberta: comprador, tier, situação e avatar sorteado |
| GET | `/v1/chain/owners/:address` | público | Lotes e avatares de uma carteira |
| GET | `/internal/v1/chain/events?after=&limit=` | serviços (`x-service-token`) | Feed de eventos confirmados, em ordem; `next_after` para a próxima página |
| GET | `/healthz`, `/metrics` | — | Saúde e métricas ([infra/observability](../../infra/observability/README.md)) |

## Banco

O esquema próprio `indexer` tem:
- `chain_event`: cada evento, com bloco, hash, transação, log, contrato e argumentos;
- `cursor`: último bloco lido e o hash dele, por rede;
- as projeções `lot_token`, `avatar_token` e `box_request`, que podem ser refeitas a partir dos eventos.

As migrações ficam em `drizzle/`, controladas em `drizzle.__indexer_migrations`.

## Ainda não

- **Depósito SCITY → THALER:** depende do `GameVault` (trilha de contratos, passo 8). O lugar já existe: um handler de `Deposited` vai creditar no ledger com a chave `chain:<chain_id>:<tx_hash>:<log_index>`, então o crédito acontece uma vez só.
- **Usar o feed no world:** atualizar o dono do lote no jogo quando ele é transferido on-chain, o que pede a ligação carteira → conta do gateway. No game-core, o mesmo para os avatares.
- **Teste na BSC Testnet:** precisa do VRF da Chainlink e de BNB de teste.
