# Trilha — Infraestrutura

Pasta: [`infra/`](../../infra/README.md) · Especificação: [doc 05 §5](../05-arquitetura-tecnica.md#5-infraestrutura-aws), [doc 10](../10-seguranca-compliance.md)

## Caminho de desenvolvimento

| Passo | Etapa | O que fazer | Pronto quando |
|------:|-------|-------------|---------------|
| 1 | 0 | **Rotacionar credenciais legadas** (chaves SSH/`.pem`, AWS, banco, SendGrid, Stripe) e guardar no Secrets Manager | Checklist do doc 10 §1 concluído |
| 2 | 0 | CI no GitHub Actions: lint, testes e build por pasta alterada ([ci.yml](../../.github/workflows/ci.yml)) | PRs bloqueados sem CI verde |
| 3 | 0 | `infra/docker/docker-compose.dev.yml` (Postgres, Redis, Strapi DB, anvil) | `docker compose up` funcionando |
| 4 | 1 | IaC (Terraform ou CDK — ADR) para o ambiente `dev`: VPC, RDS, ElastiCache, ECS, S3 + CloudFront | `dev` criado só por código |
| 5 | 1 | CDN do WebGL com `Content-Encoding: br` e `Content-Type` corretos; cache por hash dos bundles | Build carrega sem fallback de descompressão |
| 6 | 1 | Observabilidade: OpenTelemetry, CloudWatch, Sentry, alertas | Painel por serviço |
| 7 | 2 | Ambiente `staging` + deploy contínuo da `main` | Deploy automático após merge |
| 8 | 2 | Build Unity WebGL no CI (runner com licença Unity) e publicação no CDN | Build por PR com link de preview |
| 9 | 3 | Teste de carga (k6 para API, bots WebSocket para Realtime) | 10 mil simultâneos e 1 mil req/s |
| 10 | 4 | `prod`: Multi-AZ, backups, WAF, runbooks, KMS para o signer | Revisão de prontidão aprovada |

## Ambientes

| Ambiente | Blockchain | Dados | Deploy |
|----------|-----------|-------|--------|
| `local` | anvil | seed | manual |
| `dev` | BSC Testnet | seed | a cada merge na `main` |
| `staging` | BSC Testnet | cópia anonimizada / carga | tag `rc-*` |
| `prod` | BNB Smart Chain | real | tag de release com aprovação manual |
