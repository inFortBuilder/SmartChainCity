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
| Imóveis | `Transfer`, `PropertyMinted` e `PropertyUpgraded` do `PropertyNFT`: dono, lote âncora, tipo e nível |
| Caixas | `BoxOpened` e `AvatarRevealed` da `LuckyBox`: quem abriu, situação e avatar sorteado |
| Depósitos | `Deposited` do `GameVault`: vira saldo de SCITY no ledger (veja abaixo). `Withdrawn` e `VoucherCancelled` ficam no feed |
| Feed | `GET /internal/v1/chain/events?after=<id>` entrega os eventos confirmados, em ordem, para os outros serviços (com `x-service-token`) |

`LotSold` fica só no registro de eventos, porque a posse vem do `Transfer`.

**Testado no anvil em 2026-11-20, de ponta a ponta.** Com os contratos do `DeployLocal`:
- uma caixa foi aberta e sorteada, e o avatar 1 (Comum · enfermeira) apareceu com o jogador;
- um lote foi comprado com cotação assinada e depois transferido;
- só depois de 1 confirmação o espelho passou o lote para o novo dono;
- uma Casa T1 mintada e levada ao nível 2 apareceu com o dono, o lote, o tipo `t1` e o nível 2.

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

## Depósitos do GameVault

A cada rodada, depois de ler os blocos confirmados, o indexer credita os depósitos pendentes:

1. pergunta ao gateway de quem é a carteira (`GET /internal/v1/wallets/:address/account`). Carteira sem conta fica `pending` até ser ligada;
2. lança no ledger do economy o SCITY, em wei, de `system/vault` para o jogador (`scity_deposit`), com a chave `chain:<rede>:<tx>:<log>`;
3. marca o depósito como `credited`.

O crédito acontece uma vez só: numa reorganização as projeções são refeitas e o depósito volta a `pending`, mas o ledger devolve o lançamento antigo para a mesma chave. Ligue com `GATEWAY_URL`, `GATEWAY_TOKEN`, `ECONOMY_URL` e `ECONOMY_TOKEN`; sem os quatro, os depósitos só ficam registrados.

## API

| Método | Rota | Quem chama | O que faz |
|---|---|---|---|
| GET | `/v1/chain/status` | público | Rede, confirmações, último bloco da rede e o lido, atraso, último erro, contratos |
| GET | `/v1/chain/lots/:tokenId` | público | Dono on-chain do lote, com cidade e número |
| GET | `/v1/chain/avatars/:tokenId` | público | Dono, raridade e profissão do avatar |
| GET | `/v1/chain/properties/:tokenId` | público | Dono, lote âncora, tipo e nível do imóvel |
| GET | `/v1/chain/deposits/:address` | público | Depósitos de uma carteira no `GameVault` e se já viraram saldo (`pending`, `credited`) |
| GET | `/v1/chain/boxes/:requestId` | público | Caixa aberta: comprador, tier, situação e avatar sorteado |
| GET | `/v1/chain/owners/:address` | público | Lotes, avatares e imóveis de uma carteira |
| GET | `/v1/market/listings?limit=&all=` | público | Listagens abertas do `Marketplace`, as mais novas primeiro: vendedor, preço, prazo e itens com a coleção e o dono atual. Sem `all=true`, saem as vencidas e as velhas (`stale`: o vendedor já não tem algum NFT) |
| GET | `/v1/market/listings/:id` | público | Uma listagem, aberta ou fechada (`sold`, `cancelled` ou `replaced` quando o NFT foi listado de novo pelo dono atual) |
| GET | `/v1/market/auctions?limit=` | público | Leilões abertos, os mais novos primeiro: vendedor, preço inicial, maior lance e quem o deu, número de lances, lance mínimo agora, fim (`ended` quando passou e falta encerrar) e itens |
| GET | `/v1/market/auctions/:id` | público | Um leilão, aberto ou fechado (`settled`, com `winner` nulo se terminou sem lance, ou `cancelled`) |
| GET | `/internal/v1/chain/events?after=&limit=` | serviços (`x-service-token`) | Feed de eventos confirmados, em ordem; `next_after` para a próxima página |
| GET | `/healthz`, `/metrics` | — | Saúde e métricas ([infra/observability](../../infra/observability/README.md)) |

**Mercado no mapa:** o painel 🛒 Mercado do mapa (`docs/proposta-cidade-realista/mercado.js`) lê `/v1/market/listings` deste serviço (`?indexer=` muda o endereço; padrão `http://127.0.0.1:8040`). Na máquina local sem Postgres, um `.env` só com `RPC_URL`, `CHAIN_ID=31337`, `CONFIRMATIONS=0` e `DEPLOYMENTS_FILE` com o caminho absoluto basta: os eventos ficam em memória e são relidos ao reiniciar.

## Banco

O esquema próprio `indexer` tem:
- `chain_event`: cada evento, com bloco, hash, transação, log, contrato e argumentos;
- `cursor`: último bloco lido e o hash dele, por rede;
- as projeções `lot_token`, `avatar_token`, `property_token`, `deposit` e `box_request`, que podem ser refeitas a partir dos eventos.

As migrações ficam em `drizzle/`, controladas em `drizzle.__indexer_migrations`.

## Ainda não

- **Marketplace:** o feed já é usado pelo world (`LandNFT`, `PropertyNFT`) e pelo game-core (`AvatarNFT`, [game-core](../game-core/README.md#avatar-na-blockchain-avatarnft)); falta o contrato `Marketplace` e os eventos dele.
- **Teste na BSC Testnet:** precisa do VRF da Chainlink e de BNB de teste.

## Relógio da cadeia

`expired` (anúncio) e `ended` (leilão) usam o horário do bloco mais novo, não o do servidor: os prazos são do contrato (`block.timestamp`). O laço lê o timestamp do último bloco a cada passada e soma o tempo desde a leitura. Antes da primeira leitura, vale o relógio do servidor. Assim, num anvil com o tempo adiantado (`evm_increaseTime`) ou com um validador fora do relógio, o botão Encerrar e o filtro de vencidos batem com o que o contrato aceita.
