# Trilha — CMS / Backoffice (Strapi)

Pasta: [`cms-strapi/`](../../cms-strapi/README.md) · Origem: `C:\SmartChainCity\Strapi-main` (Strapi 4.4.3)

## Caminho de desenvolvimento

| Passo | Etapa | O que fazer | Pronto quando |
|------:|-------|-------------|---------------|
| 1 | 0 | Copiar `Strapi-main` para `cms-strapi/` **sem** `.env`, `node_modules` ou uploads | Código no repositório, sem segredos |
| 2 | 1 | **Remover** o que não é catálogo: `wallet`, `conversion`, `transaction-*`, `balance-controller`, `wallet-controller`, campo `user.balance`; mover `avatar`, `land`, `property`, `coordinate` para o Game Core | Strapi só com catálogo e conteúdo |
| 3 | 1 | Migrar para **Strapi 5** e Node LTS | Admin funcionando em dev |
| 4 | 1 | Criar os tipos de catálogo: `rarity`, `job` (com raridade e faixa de ganho), `job_task`, `activity`, `food`, `property_type`, `property_level` | Dados de exemplo cadastrados |
| 5 | 1 | **Seed** com as 44 profissões e tarefas do GDD (cap. 4), alimentos e multiplicadores da Tabela de Atributos | Script `pnpm --filter @scc/cms seed` idempotente |
| 6 | 1 | Webhook `entry.publish` → Game Core invalida o cache | Mudança aparece no jogo sem deploy |
| 7 | 2 | Papéis do admin: *game designer* (edita balanceamento), *conteúdo* (textos/arte), *leitura* | Permissões testadas |
| 8 | 3 | Tipos de fase 2: `vehicle_type`, `pet_type`, `crop`, `animal_type`, `machine_type`, `disaster`, `disease`, `weekly_event`, `season_modifier`, `tax_rule` | Catálogo completo |
| 9 | 3 | Versionamento de balanceamento: cada publicação gera um `catalog_version` exportado em JSON | Rollback de balanceamento possível |

## Regras
- O Strapi **não** guarda saldo, posse nem estado de jogador.
- Toda mudança de preço ou probabilidade publicada vem com o relatório do simulador no PR ou no comentário da versão.
- i18n ligado para nomes e descrições (PT-BR padrão, EN e ES depois).
