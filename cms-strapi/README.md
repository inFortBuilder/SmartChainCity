# cms-strapi

Backoffice de **catálogo** (profissões, tarefas, alimentos, imóveis, eventos, textos) em Strapi 5 ([ADR-0006](../docs/adr/0006-strapi-backoffice.md)). O Strapi não guarda saldo, posse nem estado de jogador.

- Caminho de desenvolvimento: [docs/desenvolvimento/trilha-cms.md](../docs/desenvolvimento/trilha-cms.md)
- Origem: `C:\SmartChainCity\Strapi-main` (Strapi 4.4.3). Ao importar, **não** trazer `.env`, uploads nem os endpoints de saldo (ver [docs/10 §1](../docs/10-seguranca-compliance.md)).

## Strapi 5

O Strapi 5.62 (TypeScript) fica nesta pasta, com npm próprio, fora do workspace do pnpm. Usa o Postgres do `pnpm db:up`, no esquema próprio `cms`.

| O que | Como |
|---|---|
| Tipo **Profissão** (`api::job.job`) | código, nome, raridade, ganho do dia (`tokens`), duração e a lista de **Tarefas** (componente `game.job-task`: nome, energia, felicidade, minutos, tokens), com rascunho e publicação |
| Tipo **Atividade** (`api::activity.activity`) | 95 atividades fora do trabalho (GDD 4.5), em 12 grupos (transportes, pets, educação, alimentação, parque, ginásio, galeria, hospital, academia, lojas, moradia, higiene), com o efeito em energia, saúde, felicidade, alimentação e higiene |
| Tipo **Alimento** (`api::food.food`) | 17 alimentos da Tabela de Atributos (doc 02 §7): energia, saúde, pacote, nível da fazenda que produz e preço |
| Tipo **Raridade** (`api::rarity.rarity`) | As 4 raridades com a faixa de ganho por dia (doc 02 §2.2) e o preço do combo |
| Tipo **Multiplicador** (`api::attribute-multiplier.attribute-multiplier`) | 36 linhas: multiplicador do ganho por nível de saúde, felicidade, experiência e pet (doc 02 §2.4) |
| Tipo **Tipo de imóvel** (`api::property-type.property-type`) | 26 tipos (6 residenciais, 12 comerciais, 3 industriais, 5 rurais, doc 03 §6) com os níveis no componente `game.property-level` (renda máxima e custo de upgrade) |
| Leitura pública | Na inicialização, o papel público ganha `find` e `findOne` de todos os tipos do catálogo: é dado público do jogo. Só o publicado aparece |
| Webhook para o game-core | Na inicialização, se o `.env` tiver `CATALOG_WEBHOOK_URL` e `CATALOG_WEBHOOK_TOKEN`, o Strapi registra o webhook "game-core: atualizar catálogo" (publicar, despublicar, apagar). O game-core recarrega as profissões sem deploy (trilha, passo 6); aviso de outro tipo é ignorado (`{ ignored: "food" }`) até o game-core usar esse tipo |
| Seed | `npm run seed` carrega e publica tudo o que está em `seed/`. Pode rodar de novo: atualiza pela chave (código, ou atributo e nível), não duplica. `npm run seed -- food` carrega só um tipo |

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

## Demais tipos do catálogo (seed)

| Arquivo | Origem | Como sai |
|---|---|---|
| [`seed/atividades.json`](seed/atividades.json) | GDD, seção 4.5 "Atividades extras" | Gerado: `node cms-strapi/scripts/gdd-atividades.mjs gdd.txt cms-strapi/seed/atividades.json` (o leitor tem teste) |
| [`seed/alimentos.json`](seed/alimentos.json) | Tabela de Atributos, doc 02 §7 e §6 | À mão |
| [`seed/raridades.json`](seed/raridades.json) | Tabela de Atributos, doc 02 §2.2 | À mão |
| [`seed/multiplicadores.json`](seed/multiplicadores.json) | Tabela de Atributos, doc 02 §2.4 | À mão |
| [`seed/imoveis.json`](seed/imoveis.json) | GDD §3.4, doc 03 §6 | À mão |

O teste [`scripts/seed.test.mjs`](scripts/seed.test.mjs) confere os arquivos antes da carga: códigos únicos, efeitos na escala dos atributos (−10 a 10), profissões dentro da faixa da raridade, multiplicadores que não caem quando o nível sobe e upgrade de imóvel a partir de um tipo que existe.

### Para o game designer conferir (demais tipos)

| O quê | Situação |
|---|---|
| **Atividades** | O GDD só dá a direção do efeito ("+felicidade, −energia"). O seed grava 1 ou −1 em cada atributo e anota em `conferir`. Pela planilha, a UI mostra só a direção, mas o servidor precisa do número |
| **Atividades estranhas** | "Assaltar loja" e "Destruir loja" dão +felicidade; "Tomar banho" na academia dá +energia e na higiene dá +saúde e +higiene. Ficaram como no GDD |
| **Tomate** | A planilha tem o tomate duas vezes (+2 e +3 de saúde). O seed usa +2 e anota (doc 11, conflito 4) |
| **Preço dos alimentos** | Não está no GDD nem na planilha transcrita. Fica vazio; o simulador conta 12 THALER/dia de alimentação |
| **Multiplicador de pet** | A tabela pula do nível 7 para o 3. Os níveis 6, 5 e 4 seguem o passo de 0,02 (1,06, 1,04, 1,02) e estão anotados |
| **Imóveis** | Capacidade, preço, renda e custo de upgrade estão na "Figura 16" do GDD, que não veio no texto (doc 11, lacuna 3). Os campos ficam vazios; só o T1 nível 1 traz a premissa do simulador (4000 THALER, renda de 10/dia) |

## Problema de desenho nas profissões

O minigame de cada profissão gasta de 5 a 20 de energia, mas o atributo energia vai de 0 a 10. Até isso ser acertado, o turno do game-core gasta uma energia fixa (3 no de 6 h, 6 no de 12 h).

## Testes

```bash
pnpm --filter @scc/cms test
```
