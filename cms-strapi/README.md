# cms-strapi

Backoffice de **catálogo** (profissões, tarefas, alimentos, imóveis, eventos, textos) em Strapi 5 ([ADR-0006](../docs/adr/0006-strapi-backoffice.md)). O Strapi não guarda saldo, posse nem estado de jogador.

- Caminho de desenvolvimento: [docs/desenvolvimento/trilha-cms.md](../docs/desenvolvimento/trilha-cms.md)
- Origem: `C:\SmartChainCity\Strapi-main` (Strapi 4.4.3). Ao importar, **não** trazer `.env`, uploads nem os endpoints de saldo (ver [docs/10 §1](../docs/10-seguranca-compliance.md)).

## Strapi 5

O Strapi 5.62 (TypeScript) fica nesta pasta, com npm próprio, fora do workspace do pnpm. Usa o Postgres do `pnpm db:up`, no esquema próprio `cms`.

| O que | Como |
|---|---|
| Tipo **Profissão** (`api::job.job`) | código, nome, raridade, ganho do dia (`tokens`), duração e a lista de **Tarefas** (componente `game.job-task`: nome, energia, felicidade, minutos, tokens), com rascunho e publicação |
| Leitura pública | Na inicialização, o papel público ganha `find` e `findOne` das profissões: o catálogo é dado público do jogo. Só o publicado aparece |
| Webhook para o game-core | Na inicialização, se o `.env` tiver `CATALOG_WEBHOOK_URL` e `CATALOG_WEBHOOK_TOKEN`, o Strapi registra o webhook "game-core: atualizar catálogo" (publicar, despublicar, apagar). O game-core recarrega o catálogo sem deploy (trilha, passo 6) |
| Seed | `npm run seed` carrega as 44 profissões de `seed/profissoes.json` e publica. Pode rodar de novo: atualiza pelo código, não duplica |

```bash
pnpm db:up                       # na raiz do monorepo
cd cms-strapi
cp .env.example .env             # gere as chaves APP_KEYS, *_SALT, *_SECRET
npm install
npm run develop                  # admin em http://localhost:1337/admin (crie o seu usuário)
npm run seed                     # em outro terminal, com o Strapi parado ou no ar
```

No `.env`, além das chaves do Strapi, `DATABASE_*` aponta para o Postgres local com `DATABASE_SCHEMA=cms` (crie o esquema uma vez: `create schema cms`). Para o webhook, `CATALOG_WEBHOOK_URL=http://127.0.0.1:8020/internal/v1/catalog/refresh` e `CATALOG_WEBHOOK_TOKEN` = o `INTERNAL_TOKEN` do game-core. No game-core, `CMS_URL=http://127.0.0.1:1337`.

O game-core confere todo catálogo que chega do Strapi antes de trocar: ganho fora da faixa da raridade, profissão sem tarefas ou profissão em uso que sumiu (despublicada) são recusados (`422 catalog_rejected`), e o jogo segue com o anterior. Sem o Strapi no ar, vale o seed.

## Catálogo de profissões (seed)

[`seed/profissoes.json`](seed/profissoes.json) tem as **44 profissões** do GDD original (capítulo 4, "Atividades dos minigames das profissões"): raridade, ganho de um dia de trabalho em THALER, duração do minigame e as 365 tarefas, com energia, felicidade, minutos e tokens de cada uma. É o seed dos tipos `job` e `job_task` do Strapi (trilha do CMS, passo 5). Até o Strapi existir, o [game-core](../services/game-core/README.md) lê este arquivo diretamente: o ganho base do turno é o da profissão (Padeiro 125, Pedreiro 100…).

O arquivo é gerado, não editado à mão:

```bash
npm install --no-save pdfjs-dist@4.10.38
node cms-strapi/scripts/gdd-texto.mjs "C:/SmartChainCity/Smart Chain City - FGV Jr/Smart Chain City.docx.pdf" gdd.txt
node cms-strapi/scripts/gdd-profissoes.mjs gdd.txt cms-strapi/seed/profissoes.json
```

O PDF é da FGV Jr. e do cliente e não é versionado; só o catálogo que sai dele. O leitor ([`scripts/gdd-profissoes.mjs`](scripts/gdd-profissoes.mjs), com teste) corrige o que o PDF bagunça: sumário com número de página, ordem de tokens e minutos trocada, cabeçalho quebrado em duas linhas, ponto no lugar de vírgula, "- energia" sem número (vale 1) e dois nomes com erro de digitação ("Confeitero", "Administativo de Condomínio").

O game-core confere o catálogo ao subir: 44 profissões, códigos únicos, tarefas em todas e o ganho de cada uma dentro da faixa da raridade que o simulador aprovou (comum 100–125, raro 140–165, épico 180–205, lendário 225–250). Todas passam.

### Para o game designer conferir

O **cabeçalho** de cada profissão (ganho e duração) é o valor oficial. Em 25 das 44, as tarefas do GDD não somam o mesmo; a diferença fica no campo `conferir` de cada uma:

| Profissão | Diferença no GDD |
|---|---|
| Alfaiate | tarefas somam 235 minutos; o cabeçalho diz 240 |
| Agricultor | tarefas somam 226 minutos; o cabeçalho diz 225 |
| Professor | tarefas somam 220 minutos; o cabeçalho diz 235 |
| Bombeiro | tarefas somam 235 minutos; o cabeçalho diz 245 |
| Tosador | tarefas somam 0 tokens; o cabeçalho diz 100 |
| Corretor de Imóveis | tarefas somam 0 tokens; o cabeçalho diz 100 |
| Modelista | tarefas somam 135 tokens; o cabeçalho diz 140 |
| Confeiteiro | tarefas somam 250 minutos; o cabeçalho diz 265 |
| Pescador | tarefas somam 170 tokens; o cabeçalho diz 165; tarefas somam 270 minutos; o cabeçalho diz 260 |
| Dentista | tarefas somam 145 tokens; o cabeçalho diz 165; tarefas somam 190 minutos; o cabeçalho diz 200 |
| Orientador escolar | tarefas somam 150 tokens; o cabeçalho diz 160; tarefas somam 215 minutos; o cabeçalho diz 270 |
| Policial | tarefas somam 165 tokens; o cabeçalho diz 160; tarefas somam 205 minutos; o cabeçalho diz 185 |
| Cozinheiro | tarefas somam 310 minutos; o cabeçalho diz 270 |
| Fazendeiro | tarefas somam 195 tokens; o cabeçalho diz 185 |
| Farmacêutico | tarefas somam 165 tokens; o cabeçalho diz 185 |
| Perito | tarefas somam 200 tokens; o cabeçalho diz 180 |
| Piloto | tarefas somam 315 tokens; o cabeçalho diz 185; tarefas somam 460 minutos; o cabeçalho diz 230 |
| Adestrador | tarefas somam 140 tokens; o cabeçalho diz 180 |
| Concierge | tarefas somam 260 minutos; o cabeçalho diz 250 |
| Veterinário | tarefas somam 220 minutos; o cabeçalho diz 240 |
| Incorporador | tarefas somam 250 minutos; o cabeçalho diz 240 |
| Engenheiro Civil | tarefas somam 220 minutos; o cabeçalho diz 230 |
| Diretor | tarefas somam 240 tokens; o cabeçalho diz 250; tarefas somam 215 minutos; o cabeçalho diz 265 |
| Delegado | tarefas somam 230 tokens; o cabeçalho diz 240; tarefas somam 260 minutos; o cabeçalho diz 240 |
| Astronauta | tarefas somam 220 tokens; o cabeçalho diz 235; tarefas somam 265 minutos; o cabeçalho diz 230 |

E um problema de desenho: o minigame de cada profissão gasta de 5 a 20 de energia, mas o atributo energia vai de 0 a 10. Até isso ser acertado, o turno do game-core gasta uma energia fixa (3 no de 6 h, 6 no de 12 h).

## Testes

```bash
pnpm --filter @scc/cms test
```
