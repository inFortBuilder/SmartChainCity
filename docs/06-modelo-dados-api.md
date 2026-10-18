# 06 — Modelo de Dados e API

## 1. Mapeamento do Strapi atual → novo modelo

| Strapi 4 (atual) | Problemas | Novo destino |
|------------------|-----------|--------------|
| `avatar` (nft, education, energy, happiness, health, food, job, user 1:1) | `education` máx. 10 (GDD fala 100); usuário **1:1** com avatar (GDD permite 3); falta raridade | `game.avatar` (Game Core) |
| `job` (job_name) | Sem raridade, ganho ou tarefas | `catalog.job` + `catalog.job_task` (Strapi) |
| `activity` (pontos de saúde/felicidade/energia/comida) | OK como catálogo | `catalog.activity` (Strapi) |
| `food` (name, price, activity, **user**) | Mistura catálogo e inventário do usuário | `catalog.food` + `game.inventory_item` |
| `land` (coordinate, rarity, user) | Raridade de lote não está no GDD; sem região/zona | `world.lot` |
| `coordinate` (x, y, land, property) | Entidade separada desnecessária | Colunas `x, y` em `world.lot` |
| `rarity` (name, landPrice) | Preço por raridade, GDD usa preço por região | `catalog.rarity` + `world.region_price` |
| `property` (type, level, wear, allocation_date, last_claim_date) | Boa base | `world.property` |
| `property-type` (build_hours/min/sec, photo, model) | Boa base | `catalog.property_type` (Strapi) |
| `property-level` (level 1–3, max_income, upgrade_cost) | Boa base | `catalog.property_level` (Strapi) |
| `wallet` (scity, thaler, address) | Saldos como `float` (erro de arredondamento) | `economy.account` + ledger |
| `conversion`, `conversion-factor` | Base para câmbio | `economy.fx_rate`, `economy.conversion` |
| `transaction-blockchain` (deposit) | Base para indexer | `chain.tx` |
| `transaction-game` (pet, food) | Base para ledger | `economy.ledger_entry` |
| `user.balance` (campo extra) + `balance-service` | Saldo duplicado e alterável pelo cliente | **Remover** |

**Regra de valores monetários:** usar `NUMERIC(38,0)` em unidades mínimas (THALER com 2 casas → centavos; SCITY com 18 casas → wei). Nunca `float`.

---

## 2. Esquema proposto (PostgreSQL)

```sql
-- CONTAS ------------------------------------------------------------
create table account (
  id uuid primary key,
  email citext unique,
  created_at timestamptz not null default now(),
  status text not null default 'active',         -- active | suspended | banned
  kyc_level smallint not null default 0
);
create table wallet_link (
  account_id uuid references account(id),
  address    text not null unique,                -- checksum EIP-55
  chain_id   int  not null,
  verified_at timestamptz not null,               -- assinatura SIWE
  primary key (account_id, address)
);

-- AVATARES ----------------------------------------------------------
create table avatar (
  id uuid primary key,
  token_id numeric(78,0) unique,                  -- NFT
  account_id uuid not null references account(id),
  rarity text not null,                           -- common|rare|epic|legendary
  job_code text not null,                         -- catálogo
  energy smallint not null check (energy between 0 and 10),
  health smallint not null check (health between 0 and 10),
  happiness smallint not null check (happiness between 0 and 10),
  food smallint not null check (food between 0 and 10),
  hygiene smallint not null default 10,
  education smallint not null default 0 check (education between 0 and 100),
  home_property_id uuid,                          -- onde mora
  employment_status text not null default 'employed',
  last_worked_at timestamptz,
  updated_at timestamptz not null default now()
);
create table avatar_condition (                    -- doenças, buffs, itens temporários
  avatar_id uuid references avatar(id),
  code text, expires_at timestamptz, payload jsonb,
  primary key (avatar_id, code)
);
create table work_shift (
  id uuid primary key,
  avatar_id uuid references avatar(id),
  job_code text, shift_hours smallint,             -- 6 | 12
  starts_at timestamptz, ends_at timestamptz,
  seed_commit bytea, seed_reveal bytea,
  result jsonb,                                    -- tarefas, danos, deltas
  thaler_earned numeric(38,0),
  status text                                      -- running|done|claimed|cancelled
);

-- MUNDO -------------------------------------------------------------
create table region (
  code text primary key,                           -- A1, A2-03, A3-11...
  rx int, ry int, ring int,
  opened_at timestamptz,
  base_lot_price numeric(38,0)
);
create table lot (
  x int, y int,
  region_code text references region(code),
  hood_x int, hood_y int, cell_x int, cell_y int,
  use text not null,                               -- buildable|road|water|green|civic
  zone text,                                       -- residential|commercial|industrial|rural
  mineable boolean not null default false,
  token_id numeric(78,0) unique,
  owner_account_id uuid references account(id),
  water boolean default false, power boolean default false,
  regularized_as text,                             -- residential|commercial|null
  idle_since timestamptz,                          -- base do PT crescente
  primary key (x, y)
);
create table property (
  id uuid primary key,
  token_id numeric(78,0) unique,
  type_code text not null, level smallint not null default 1,
  owner_account_id uuid references account(id),
  anchor_x int, anchor_y int,                      -- lote âncora
  footprint smallint not null default 1,           -- 1 ou 2 lotes
  wear smallint not null default 100,
  build_ready_at timestamptz,
  last_claim_at timestamptz,
  insured_until timestamptz,
  foreign key (anchor_x, anchor_y) references lot(x, y)
);
create table lease (                               -- aluguel de unidade/quarto
  id uuid primary key, property_id uuid references property(id),
  tenant_avatar_id uuid references avatar(id),
  price_per_day numeric(38,0), starts_at timestamptz, ends_at timestamptz
);

-- ECONOMIA (ledger de dupla entrada) --------------------------------
create table ledger_account (
  id uuid primary key,
  owner_type text,           -- player | system | pool | burn | escrow
  owner_id uuid, currency text,                    -- THALER | SCITY
  unique (owner_type, owner_id, currency)
);
create table ledger_tx (
  id uuid primary key, kind text,                  -- shift_pay|food|tax|fx|...
  ref_type text, ref_id uuid, idempotency_key text unique,
  created_at timestamptz default now()
);
create table ledger_entry (
  tx_id uuid references ledger_tx(id),
  account_id uuid references ledger_account(id),
  amount numeric(38,0) not null,                   -- + crédito / − débito
  primary key (tx_id, account_id)
);
-- invariante: para cada tx, sum(amount) = 0 por moeda
create table fx_rate (valid_from timestamptz primary key, thaler_per_scity numeric(20,6), source text);
create table withdrawal_voucher (
  id uuid primary key, account_id uuid, address text,
  amount_wei numeric(78,0), nonce numeric(78,0) unique,
  deadline timestamptz, signature bytea, status text
);

-- CADEIA ------------------------------------------------------------
create table chain_tx (
  tx_hash text primary key, block_number bigint, log_index int,
  contract text, event text, payload jsonb,
  confirmations int, processed_at timestamptz
);
```

Catálogo no Strapi (content-types): `rarity`, `job`, `job_task`, `activity`, `food`, `property_type`, `property_level`, `vehicle_type`, `pet_type`, `crop`, `animal_type`, `machine_type`, `disaster`, `disease`, `weekly_event`, `season_modifier`, `tax_rule`.

---

## 3. API REST (v1)

Autenticação: `Authorization: Bearer <JWT>`. Toda mutação aceita `Idempotency-Key`.

### Auth
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/v1/auth/siwe/nonce` | Nonce para assinatura |
| POST | `/v1/auth/siwe/verify` | Verifica assinatura → JWT |
| POST | `/v1/auth/email/login` | Login por e-mail (carteira embutida) |
| GET | `/v1/me` | Conta, carteiras, avatares, saldos |

### Avatares e trabalho
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/v1/avatars` | Avatares da conta |
| GET | `/v1/avatars/:id` | Atributos, condições, turno atual |
| POST | `/v1/avatars/:id/work` | `{shift: 6|12, commute: "car"|"skate"|"walk"|"bus"|"home"}` |
| POST | `/v1/avatars/:id/claim` | Coletar turno concluído |
| POST | `/v1/avatars/:id/consume` | `{itemId}` — comer / remédio |
| POST | `/v1/avatars/:id/activities` | `{activityCode, placeId}` — lazer, academia, escola |
| POST | `/v1/avatars/:id/move-in` | `{propertyId}` ou aluguel/hotel |

### Mundo e imóveis
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/v1/world/regions` | Regiões abertas e preços |
| GET | `/v1/world/cells/:cx/:cy` | Lotes da célula (uso, dono, imóvel) — alimenta o streaming |
| GET | `/v1/lots/:x/:y` | Detalhe do lote |
| POST | `/v1/lots/:x/:y/quote` | Cotação de compra primária (valida regras de bairro e cerco) |
| POST | `/v1/lots/:x/:y/regularize` | `{as: "residential"|"commercial"}` |
| POST | `/v1/lots/:x/:y/utilities` | Contratar água/energia |
| POST | `/v1/properties` | Construir `{typeCode, anchor:{x,y}}` |
| POST | `/v1/properties/:id/upgrade` | Subir nível |
| POST | `/v1/properties/:id/repair` | Reparador |
| POST | `/v1/properties/:id/insure` | Seguro |
| POST | `/v1/properties/:id/claim` | Coletar renda |

### Economia
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/v1/economy/balances` | THALER e SCITY no jogo |
| GET | `/v1/economy/ledger?cursor=` | Extrato |
| GET | `/v1/economy/fx` | Câmbio vigente e spread |
| POST | `/v1/economy/withdrawals` | Pede voucher de saque (aplica limites) |
| GET | `/v1/market/listings` | Marketplace off-chain |

### Metadados NFT (público)
| GET | `/meta/avatar/:tokenId` · `/meta/lot/:tokenId` · `/meta/property/:tokenId` |
|-----|---|

## 4. Mensagens WebSocket (Realtime)

```jsonc
// cliente → servidor
{"t":"join_cell","cx":4,"cy":4}
{"t":"move","x":12.5,"z":-3.2,"rot":90}
{"t":"chat","text":"..."}               // filtrado no servidor
// servidor → cliente
{"t":"presence","players":[{"id":"…","x":12.5,"z":-3.2,"look":{…}}]}
{"t":"shift_done","avatarId":"…","thaler":"11850"}
{"t":"world_event","kind":"blimp_promo","payload":{…}}
{"t":"lot_changed","x":-3,"y":0,"owner":"…"}
```
