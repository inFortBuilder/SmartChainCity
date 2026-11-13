# Trilha — CMS / Backoffice (Strapi)

Pasta: [`cms-strapi/`](../../cms-strapi/README.md) · Origem: `C:\SmartChainCity\Strapi-main` (Strapi 4.4.3)

## Caminho de desenvolvimento

| Passo | Etapa | O que fazer | Pronto quando |
|------:|-------|-------------|---------------|
| 1 | 0 | Copiar `Strapi-main` para `cms-strapi/` **sem** `.env`, `node_modules` ou uploads | Código no repositório, sem segredos |
| 2 | 1 | **Remover** o que não é catálogo: `wallet`, `conversion`, `transaction-*`, `balance-controller`, `wallet-controller`, campo `user.balance`; mover `avatar`, `land`, `property`, `coordinate` para o Game Core | Strapi só com catálogo e conteúdo |
| 3 | 1 | ✅ **Strapi 5** (5.62, TypeScript, Node 24), no Postgres local, esquema `cms`. Feito do zero em vez de migrar o 4.4.3, que misturava saldo e posse | Admin funcionando em dev |
| 4 | 1 | ✅ Criar os tipos de catálogo: `rarity`, `job` (com raridade e faixa de ganho), `job_task`, `activity`, `food`, `property_type`, `property_level`. `job_task` e `property_level` são componentes (repetíveis) de `job` e `property_type`; mais o tipo `attribute_multiplier` para a Tabela de Atributos ([README](../../cms-strapi/README.md#strapi-5)) | Dados de exemplo cadastrados (todos publicados no Strapi local) |
| 5 | 1 | ✅ **Seed** com as 44 profissões e tarefas do GDD (cap. 4), 95 atividades (GDD 4.5), 17 alimentos, 4 raridades, 36 multiplicadores e 26 tipos de imóvel ([README](../../cms-strapi/README.md#demais-tipos-do-catálogo-seed)). Valores que o GDD não tem (efeito exato das atividades, preço dos alimentos, renda dos imóveis) ficam vazios ou provisórios, anotados em `conferir` | Script `npm run seed` (em `cms-strapi`) idempotente ✅ |
| 6 | 1 | ✅ Webhook `entry.publish` → game-core recarrega o catálogo, conferindo antes ([README](../../cms-strapi/README.md#strapi-5)) | Mudança aparece no jogo sem deploy (testado: nome publicado no Strapi chegou ao game-core) |
| 7 | 2 | ✅ Papéis do admin: *game designer* (edita balanceamento e publica), *conteúdo* (textos/arte, sem publicar), *leitura*. Ficam no código ([README](../../cms-strapi/README.md#papéis-do-admin)) | Permissões testadas (`npm run test:papeis`, 12 casos) ✅ |
| 8 | 3 | Tipos de fase 2: `vehicle_type`, `pet_type`, `crop`, `animal_type`, `machine_type`, `disaster`, `disease`, `weekly_event`, `season_modifier`, `tax_rule` | Catálogo completo |
| 9 | 3 | Versionamento de balanceamento: cada publicação gera um `catalog_version` exportado em JSON | Rollback de balanceamento possível |

## Regras
- O Strapi **não** guarda saldo, posse nem estado de jogador.
- Toda mudança de preço ou probabilidade publicada vem com o relatório do simulador no PR ou no comentário da versão.
- i18n ligado para nomes e descrições (PT-BR padrão, EN e ES depois).
