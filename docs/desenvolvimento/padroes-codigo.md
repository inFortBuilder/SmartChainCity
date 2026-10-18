# Padrões de Código

## Gerais
- Código, nomes de variáveis e commits em **inglês**; documentação e textos de interface em **português** (com i18n).
- Valores monetários **nunca** em ponto flutuante: `bigint`/`NUMERIC` em unidades mínimas (THALER em centavos; SCITY em wei).
- Regras de jogo (preços, probabilidades, durações) vêm do **catálogo**, nunca fixas no código.
- Toda mutação de estado do jogador é **idempotente** (`Idempotency-Key`).
- Tempo sempre em UTC no servidor; o cliente converte para exibição.

## TypeScript (services, cms, tools)
- `strict: true`; ESLint + Prettier; sem `any` sem justificativa.
- Camadas por serviço: `api/` (controllers, DTOs com validação) → `domain/` (regras puras, testáveis) → `infra/` (banco, fila, chain).
- Regras de domínio sem dependência de framework — ex.: `calculateShiftEarnings(input): Result`.
- Erros de domínio tipados (`InsufficientEnergy`, `LotNotOwned`), mapeados para HTTP no `api/`.
- Banco: migrações versionadas (Prisma, Drizzle ou Knex — escolher em ADR); transações explícitas para o ledger.

## C# (Unity)
- Namespaces `SCC.<Area>` (`SCC.City`, `SCC.Net`, `SCC.Wallet`, `SCC.UI`).
- Pasta do projeto: `Assets/_SCC/<Area>/{Scripts,Prefabs,Art,Scenes}`; assets de terceiros fora de `_SCC`.
- Nenhuma regra de economia no cliente: o cliente pede ações e mostra o estado retornado pelo servidor.
- Carregamento de conteúdo **só via Addressables** (`AssetReference`), nunca `Resources.Load` para conteúdo da cidade.
- `async/await` com `UniTask` (ou `Awaitable` do Unity 6) para rede e carregamento; nada de bloquear a thread principal.
- Sem alocações por frame em `Update` de objetos repetidos (lotes, NPCs).

## Solidity (contracts)
- Solidity 0.8.x fixada em `foundry.toml`; OpenZeppelin v5.
- Padrão *checks-effects-interactions*; `ReentrancyGuard` em funções com transferência.
- Eventos para **toda** mudança de estado relevante, inclusive taxas e parâmetros.
- NatSpec em todas as funções públicas.
- Nada de `tx.origin`; nada de laços sem limite sobre arrays de usuários.

## Dados e catálogo
- Códigos estáveis em `snake_case` (`job_code = "civil_engineer"`); o nome exibido é traduzível.
- Alterações de balanceamento passam pelo simulador (`tools/econ-sim`) e o PR inclui o relatório.
