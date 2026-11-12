# Configurar o Ambiente

## Ferramentas

| Ferramenta | Versão | Usada por |
|------------|--------|-----------|
| Git + **Git LFS** | atual | Todos (arte e binários Unity vão para o LFS) |
| Node.js | LTS atual (≥ 20) | services, cms-strapi, tools |
| pnpm | ≥ 9 | Workspaces do monorepo |
| Docker + Docker Compose | atual | Banco, Redis e serviços locais |
| Unity Hub + **Unity 6 LTS** com módulo *WebGL Build Support* | definida em `client-unity/ProjectSettings/ProjectVersion.txt` | client-unity |
| Unity 2021.3.x (versão exigida pelo Spatial SDK) | ver `metaverse-spatial/` | metaverse-spatial |
| Foundry (`forge`, `anvil`, `cast`) | atual | contracts |
| Python 3.11+ | opcional | tools/osm-to-grid (se usar GeoPandas) |
| MetaMask (navegador) | — | Testes de carteira na BSC Testnet |

## Primeira execução

```bash
git clone https://github.com/inFortBuilder/SmartChainCity.git
```

```bash
git lfs install
```

```bash
pnpm install
```

```bash
docker compose -f infra/docker/docker-compose.dev.yml up -d
```

O Compose sobe PostgreSQL (5433) e Redis (6379). O Docker exige virtualização ligada na BIOS (SVM ou VT-x) e WSL 2.

**Sem Docker:** `pnpm db:up` sobe um Postgres portátil na mesma porta e com a mesma URL, sem administrador. Os dados ficam em `.local/postgres`. Use um ou outro, não os dois.

```bash
pnpm db:migrate
```

```bash
pnpm dev
```

Copie antes `services/gateway/.env.example` para `.env` e use em `JWT_SECRET` o mesmo `jwt_secret` do SCC Builder.

## Variáveis de ambiente

- Cada serviço tem um `.env.example`. Copie para `.env` e preencha **só com valores de desenvolvimento**.
- **Nunca** coloque no repositório chaves privadas, `.pem`, senhas ou tokens reais. O `.gitignore` bloqueia os padrões comuns, mas a responsabilidade é de quem faz o commit.
- Segredos de staging e produção ficam no AWS Secrets Manager (ver [trilha-infra.md](trilha-infra.md)).

## Rodar cada parte

| Parte | Comando |
|-------|---------|
| Todos os serviços em modo dev | `pnpm dev` |
| Um serviço | `pnpm --filter @scc/game-core dev` |
| Strapi | `pnpm --filter @scc/cms dev` → http://localhost:1337/admin |
| Contratos (testes) | `cd contracts && forge test` |
| Nó local + deploy | `anvil` e `forge script script/DeployLocal.s.sol --broadcast --rpc-url http://localhost:8545` |
| Simulador econômico | `cd tools/econ-sim && npm start -- --days 365 --scenario p100 --growth base` |
| Cliente Unity | Abrir `client-unity/` no Unity Hub → cena `Boot` → Play |
| Build WebGL local | Menu `SCC > Build > WebGL (Dev)` → servir `client-unity/Builds/WebGL` com `npx http-server -p 8080 --brotli` |

> Os comandos acima descrevem a estrutura-alvo; serão válidos à medida que cada pasta receber seu código (Etapas 0 e 1 do [ROADMAP](../../ROADMAP.md)).

## Carteira de teste

1. Adicionar a **BSC Testnet** na MetaMask (chain id 97).
2. Pegar BNB de teste no faucet oficial da BNB Chain.
3. Usar uma carteira **exclusiva de testes**, nunca a carteira pessoal.
