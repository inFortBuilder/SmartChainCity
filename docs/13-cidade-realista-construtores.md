# 13 — Cidade Realista e Construtores (proposta)

> **Status: proposta.** Muda a direção visual e acrescenta um sistema central ao jogo: **construtores sobem o próprio edifício (modelo 3D) no lote comprado e vendem as unidades dentro do jogo.** As decisões abertas estão no §11 e no [ADR-0009](adr/0009-cliente-web-nativo.md).

**Ver o protótipo:** na raiz do repositório, rode `php -S localhost:8081 -t .` e abra http://localhost:8081/docs/proposta-cidade-realista/index.html. São três modos:
- **Explorar:** a cidade com quadras irregulares, parques, trânsito, sombras e sol pela hora do dia.
- **Mapa de lotes:** a situação de cada lote.
- **Construtor:** o fluxo completo: lote → modelo GLB → validação → unidades → publicação → venda por andar. Aceita um `.glb` real.

---

## 1. Por que mudar

| Hoje (docs/telas, build 0.0.23) | Proposta |
|---|---|
| Cartoon isométrico, grade quadrada de lotes 10 × 10 m | Cidade em **formato real**: ruas inclinadas, quadras de formatos diferentes, lotes com área real em m² |
| Imóveis de catálogo (T1–T3, Residenciais 1–3) | Catálogo **e** edifícios criados por jogadores-construtores (UGC), com unidades vendáveis |
| Prédio = 1 NFT com renda fixa | Prédio = NFT do edifício + **um NFT por unidade** (apartamento, sala, loja) |
| Visual de jogo casual | Realismo estilizado: PBR, céu físico, sombras, reflexo nos vidros, ciclo do dia |

O tema "imóveis virtuais" ganha uma economia real de incorporação: comprar terreno, projetar, aprovar, construir e vender unidades. Jogadores comuns compram as unidades para morar, alugar ou revender.

---

## 2. Direção visual

- **Realismo estilizado:** materiais PBR (vidro com *clearcoat*, concreto, metal), céu físico com sol, *tone mapping* ACES, sombras suaves, névoa de horizonte e iluminação ambiente gerada do céu (os vidros refletem o céu).
- **Hora do dia** muda o sol e acende as janelas à noite.
- **Vida urbana:** carros nas faixas, faixas de pedestre, árvores nas calçadas, parques.
- **Interface moderna:** painéis translúcidos (*glassmorphism*), tipografia Inter, cores da marca como destaque (verde = ação, ciano = seu lote, âmbar = à venda). A logo 3D oficial continua no topo.
- **Mapa de lotes:** sobreposição colorida por situação (seu lote, à venda pela Prefeitura, à venda por jogadores, ocupado, vazio, parque).

Orçamento continua o do [doc 08 §2](08-metaverso-webgl.md#2-orçamento-de-desempenho-webgl). O protótipo renderiza cerca de 120 edifícios, centenas de árvores e 70 carros com sombras em tempo real usando *instancing* e geometria unida por edifício.

---

## 3. Cidade em formato real

O [doc 03](03-cidade-lotes-imoveis.md) previa uma grade de lotes 1 × 1. A proposta troca o **lote quadrado** por **lote poligonal**, mantendo a hierarquia administrativa (região, bairro, célula) para posse e eventos.

| Conceito | Antes | Agora |
|---|---|---|
| Lote | Quadrado 10 × 10 m em (x, y) | **Polígono** (GeoJSON, em metros) com área calculada |
| Origem do traçado | Grade gerada | Traçado real via OpenStreetMap ([doc 03 §7](03-cidade-lotes-imoveis.md#7-replicar-uma-cidade-real), nível 2) ou desenho de urbanismo |
| Regras urbanísticas | Zona (residencial, comercial…) | Zona + **gabarito** (altura máxima), **recuo**, **coeficiente de aproveitamento**, taxa de ocupação |
| ID do NFT | Derivado de (x, y) | `keccak256(regionCode, lotSeq)`; o polígono vai para os metadados e um *hash* dele vai on-chain |
| Preço primário | Por região | Por m² × fator da zona e da distância ao centro |
| Regra "1 bairro por região" | Contagem de lotes | Área total por bairro (ex.: até 30% da área do bairro) |

Parâmetros por zona usados no protótipo (a calibrar no simulador econômico):

| Zona | Gabarito | Coeficiente | Recuo | Preço base |
|---|---:|---:|---:|---:|
| Comercial central | 160 m | 6,0 | 3 m | 9,5 SCITY/m² |
| Uso misto | 60 m | 3,5 | 3 m | 5,2 SCITY/m² |
| Residencial | 15 m | 1,4 | 4 m | 2,6 SCITY/m² |

---

## 4. Fluxo do construtor

```
 Jogador-construtor
   │ 1. compra um lote (LandNFT)
   ▼
 SCC Builder (Convert3D Smart) ── 2. envia o modelo (FBX, OBJ, DAE, GLB…) → converte e otimiza → GLB "preset SCC"
   │                                    (Y para cima, metros, Draco ou meshopt, LOD0/1/2, colisor, miniatura)
   ▼
 Validação no servidor ─────────── 3. contra o polígono e as regras do lote:
   │   • cabe no lote com recuo (todos os vértices da base dentro do polígono reduzido)
   │   • altura ≤ gabarito          • área construída ≤ coeficiente (ou paga outorga onerosa)
   │   • triângulos ≤ 300 mil       • texturas ≤ 2048 px (KTX2)      • escala plausível
   ▼
 Alvará (moderação) ────────────── 4. checagem de conteúdo: nada ofensivo, nenhuma marca de terceiros, direito sobre o modelo
   │
   ▼
 Unidades ──────────────────────── 5. andares (pé-direito), unidades por andar, térreo comercial, áreas, preço por m²
   │                                    → VGV (valor geral de vendas), outorga, IPTU estimado
   ▼
 Publicação ────────────────────── 6. mint do BuildingNFT (ligado ao lote) + UnitNFT por unidade (mint sob demanda)
   │                                    → obra com prazo (andaime visual) → unidades no marketplace primário
   ▼
 Compradores ───────────────────── 7. compram a unidade: moram (avatar), alugam (renda) ou revendem (royalty para o construtor)
```

No protótipo, os passos 1–3, 5, 6 e a venda por andar funcionam no navegador. O alvará e o mint são simulados.

### 4.1 Regras de jogo novas

| Regra | Efeito econômico |
|---|---|
| **Outorga onerosa:** passar do coeficiente exige pagar à Prefeitura por m² excedente | *Sink* de SCITY; quanto mais alto, mais caro |
| **Taxa de alvará** por análise | *Sink*; desestimula envios em massa |
| **Prazo de obra** proporcional à área (andaime visível) | Tempo de retorno; evento visual na cidade |
| **IPTU por unidade** pago pelo dono da unidade | *Sink* recorrente; já previsto no doc 04 |
| **Royalty do construtor** (ex.: 2%) em cada revenda de unidade | Incentivo para construir bem |
| **Condomínio:** taxa mensal dividida entre as unidades, para manutenção (desgaste) | *Sink* e cuidado com o edifício |
| **Unidade sem dono após X dias** volta ao construtor para nova venda | Evita prédios "fantasma" |

---

## 5. SCC Builder — versão Smart do Convert3D, sem vínculo com o EventosWeb

O Convert3D (v2.8.0, `C:\Projeto-Git\SmartChainCity\Convert3D`) já faz o mais difícil: converte formatos arquitetônicos para GLB, otimiza (dedup, weld, simplificação, Draco), gera LOD, ajusta escala e eixo por engine, tem fila assíncrona com worker, API REST com chave, validação por *magic bytes* e testes. O que o prende ao EventosWeb (EW) é a camada de **identidade, escopo e armazenamento**.

### 5.1 O que sai, o que fica e o que muda

| Parte | Arquivos | Ação |
|---|---|---|
| Guarda de sessão do Adianti | `adianti-guard.php`, `Security::requireAdiantiSession()` | **Remover.** Trocar por validação do **JWT do gateway SCC** (login SIWE, [doc 05 §4](05-arquitetura-tecnica.md#4-backend)) |
| SSO do EventosWeb | `deploy/convert3d-sso.php`, modo "subdomínio" do `app.php` | **Remover.** Uma só forma de acesso: `Authorization: Bearer <JWT SCC>` |
| Módulo Adianti | `integrations/adianti/` (TRecord, TPage, SQL) | **Remover** do fork |
| Escopo por "unidade" do EW | `api/tests/testar-owner-unidade.php`, `JobRepository` (owner) | Trocar a "unidade" por `account_id` do jogador (e `builder_company_id` opcional) |
| Publicação S3 do EW | `S3Publisher.php` (lê `app/config/storage.php` da plataforma, layout `projetos/<id-usuario>/…`) | Configuração própria (bucket SCC), layout `builder/<account_id>/<model_id>/<versão>/modelo.glb`; sem dependência do `vendor/` do EW |
| Deploy | `deploy/deploy-convert3d.sh`, `ew-permissoes`, `convert3d.eventosweb.com.br` | Reescrever para a infraestrutura SCC ([trilha infra](desenvolvimento/trilha-infra.md)), contêiner próprio |
| Documentação e marca | `README.md`, `CLAUDE.md`, `assets/logo-convert3d*.svg`, menções a EW Hub/EAD | Nova marca **SCC Builder**; i18n PT/ES/EN mantido |
| **Mantém** | `bin/lib/pipeline.js`, `optimize.js`, `gltf-build.js`, `mesh-import.js`, `src/utils/*` (otimizador, LOD, presets, texturização, divisão de malhas), `api/lib/FileValidator.php`, `JobRepository.php` (SQLite), `worker.php`, testes Vitest/Playwright | Núcleo de conversão e editor, sem mudanças |
| **Novo** | — | Preset de engine **`scc`** (Y-up, metros, meshopt, LOD 3 níveis, KTX2, colisor de caixa); endpoint `POST /api/validate-lot.php` (recebe o polígono e as regras do lote e devolve as checagens do §4); arquivo lateral `modelo.meta.json` (contorno da base, altura, andares sugeridos, triângulos, caixa); miniatura PNG renderizada no servidor; *webhook* para o serviço World quando o job termina |

### 5.2 Onde fica

No monorepo, em `tools/scc-builder/` (editor + CLI) e `services/builder/` (API PHP e worker). O serviço `world` chama o builder pela API e guarda só o resultado validado. O Convert3D original continua no EventosWeb: o fork é **independente**, sem código compartilhado em tempo de execução.

> **Antes do fork:** confirmar por escrito que a Smart Chain City / UZAACOM pode usar e modificar o código do Convert3D fora do EventosWeb. A licença no repositório é MIT, mas a titularidade e o histórico de contribuição precisam estar claros.

### 5.3 Contrato entre o SCC Builder e o jogo

```jsonc
// POST /api/validate-lot.php  (Authorization: Bearer <JWT SCC>)
{
  "job_id": "job_a1b2…",
  "lot": { "id": "A1-078", "polygon": [[x,z], …], "setback_m": 3, "max_height_m": 160, "far": 6.0 },
  "transform": { "rotation_deg": 0, "units": "m" }
}
// 200
{
  "valid": true,
  "checks": [ { "code": "fits_setback", "ok": true }, { "code": "height", "ok": true, "value": 80.8 },
              { "code": "far", "ok": false, "severity": "fee", "gfa_m2": 15341, "max_m2": 9370, "outorga_scity": 14928 },
              { "code": "triangles", "ok": true, "value": 84320, "max": 300000 } ],
  "footprint": { "hull": [[x,z], …], "area_m2": 718 },
  "suggested_floors": 25,
  "artifacts": { "glb": "builder/0xabc…/mdl_9f…/v1/modelo.glb", "lod1": "…", "lod2": "…", "thumb": "…png" }
}
```

---

## 6. Modelo de dados (acréscimos ao [doc 06](06-modelo-dados-api.md))

```sql
alter table lot add column polygon jsonb not null;        -- [[x,z], …] em metros
alter table lot add column area_m2 numeric(12,2) not null;
alter table lot add column zoning jsonb not null;         -- {max_height_m, far, setback_m, occupancy}

create table building_model (                              -- versão do modelo enviada ao SCC Builder
  id uuid primary key, account_id uuid not null, builder_job_id text not null,
  glb_path text, lod_paths jsonb, thumb_path text, meta jsonb,   -- meta: hull, altura, triângulos
  moderation_status text not null default 'pending',            -- pending | approved | rejected
  created_at timestamptz default now()
);
create table building (
  id uuid primary key, token_id numeric(78,0) unique,
  lot_id text not null, model_id uuid references building_model(id),
  developer_account_id uuid not null, name text,
  floors int, floor_height_m numeric(4,2), rotation_deg numeric(5,2),
  gfa_m2 numeric(12,2), outorga_scity numeric(38,0),
  status text not null,                                    -- draft | approved | under_construction | ready
  ready_at timestamptz, royalty_bps int default 200
);
create table unit (
  id uuid primary key, token_id numeric(78,0) unique,      -- mint sob demanda na 1ª venda
  building_id uuid references building(id),
  floor int, code text, kind text,                         -- residential | commercial | office
  area_m2 numeric(8,2), list_price numeric(38,0),
  owner_account_id uuid, status text                       -- for_sale | sold | leased
);
create table unit_lease (unit_id uuid references unit(id), tenant_avatar_id uuid, price_per_day numeric(38,0), starts_at timestamptz, ends_at timestamptz);
```

API nova (gateway): `POST /v1/buildings` (rascunho a partir de um `model_id` validado), `POST /v1/buildings/:id/units` (gera as unidades), `POST /v1/buildings/:id/publish`, `GET /v1/buildings/:id/floors/:n`, `POST /v1/units/:id/buy`, `POST /v1/units/:id/lease`.

## 7. Contratos (acréscimos ao [doc 07](07-smart-contracts.md))

| Contrato | Papel |
|---|---|
| `BuildingNFT` (ERC-721) | Substitui o `PropertyNFT` para edifícios de jogadores; guarda `lotId`, `modelHash` (hash do GLB aprovado), andares e construtor |
| `UnitNFT` (ERC-721) | Uma unidade por token, com `buildingId`, andar, área e código; royalty EIP-2981 para o construtor; mint por voucher no momento da 1ª venda |
| `UnitMarket` | Venda primária das unidades (preço do construtor, taxa da plataforma, repasse ao construtor) e revenda; aluguel por período |

O `modelHash` on-chain garante que o prédio exibido é o que foi aprovado: trocar o modelo exige nova validação e novo hash.

## 8. Cliente: motor gráfico

O protótipo usa **Three.js** (o mesmo motor do editor do Convert3D) e já carrega GLB com Draco e meshopt no navegador. Isso reabre a escolha do cliente ([doc 05 §3](05-arquitetura-tecnica.md#3-cliente--unity-webgl)):

| Critério | Unity 6 WebGL + glTFast | Web nativo (Three.js ou Babylon.js) |
|---|---|---|
| Carregar GLB de jogadores em tempo real | Possível (glTFast), com integração extra | Nativo, mesmo código do SCC Builder |
| Download inicial | Pesado (o build legado tem ~133 MB) | Leve (~1 MB de motor + assets sob demanda) |
| Mobile web | Limitado (memória do WebGL) | Melhor |
| Reaproveitar validação e LOD | Reescrever em C# | Mesmo JavaScript do SCC Builder |
| Ferramentas de cena, física e animação | Fortes | Menos prontas (física com Rapier, editor próprio) |
| Equipe atual | Unity (projeto legado) | Web/PHP (site, Convert3D) |

**Recomendação:** cliente **web nativo** para a cidade, o metaverso e o UGC; Unity apenas se algum minijogo exigir. Os detalhes estão no [ADR-0009](adr/0009-cliente-web-nativo.md) (proposto), a decidir depois de um *spike* de 2 sprints.

## 9. Desempenho com prédios de jogadores

- 300 mil triângulos por edifício no LOD0; LOD1 (25%) e LOD2 (5%) gerados pelo SCC Builder; impostor (cartão) acima de 800 m.
- Texturas KTX2 de até 2048 px; materiais limitados a 8 por edifício.
- Streaming por célula ([doc 08 §3](08-metaverso-webgl.md#3-streaming-do-mundo)): só o LOD adequado de cada prédio é baixado.
- Cache por `modelHash` no CDN (imutável).

## 10. Riscos e cuidados

| Risco | Cuidado |
|---|---|
| Conteúdo impróprio ou cópia de projetos e marcas reais | Moderação no alvará, denúncia, remoção com reembolso parcial; termos de UGC |
| Venda de "espaços" com renda de aluguel pode ser vista como investimento | Parecer jurídico ([doc 10 §3](10-seguranca-compliance.md#3-riscos-regulatórios-brasil--validar-com-assessoria-jurídica)); nada de prometer rentabilidade |
| Spam de modelos | Exigir lote próprio, taxa de alvará e limite de envios por dia |
| Prédios pesados derrubando o desempenho | Validação obrigatória de polígonos e texturas, LOD e impostor |
| Dependência do EventosWeb | Fork independente (§5), sem SSO nem storage compartilhado |

## 11. Decisões pendentes

1. Adotar o cliente web nativo? ([ADR-0009](adr/0009-cliente-web-nativo.md))
2. Cidade de referência para o traçado real (qual cidade, qual recorte).
3. Unidades como ERC-721 por unidade (recomendado) ou ERC-1155.
4. Royalty do construtor, taxa de alvará e valor da outorga por m² (calibrar no simulador).
5. Quem pode ser construtor: qualquer jogador com lote, ou só contas com verificação (KYC) e depósito?
6. Titularidade do código do Convert3D para o fork.

## 12. Impacto no roadmap

| Etapa | Novo épico |
|---|---|
| 0 | **E0.9 Spike do cliente web nativo** (cidade, streaming, 60 FPS) e **E0.10 Fork SCC Builder** (remover EW, JWT SCC, preset `scc`) |
| 1 | **E1.8 Lote poligonal** (modelo de dados, pipeline OSM gerando polígonos) |
| 2 | **E2.10 Validação de lote no SCC Builder** + **E2.11 Edifícios de jogadores na testnet** (BuildingNFT, alvará manual) |
| 3 | **E3.11 Unidades e UnitMarket** (venda primária, revenda, aluguel, royalty) + **E3.12 Moderação de UGC** |

## 13. Estudo de caso: edifício grande (`edificio.glb`)

Um construtor enviou uma cena arquitetônica completa: torre, terreno e paisagismo, exportada pelo `THREE.GLTFExporter`.

### 13.1 Como chegou

| Medida | Valor | Limite do jogo |
|---|---:|---:|
| Arquivo | **413 MB** | 40 MB por envio |
| Triângulos | **4,66 milhões** | 300 mil (LOD0) |
| Vértices | 14 milhões, sem índice (cada triângulo com 3 vértices próprios) | — |
| Memória de GPU (posição + normal) | ~320 MB | ~1 GB para a cidade inteira |
| Unidade | centímetros (pé-direito medido: 307,5 = 3,07 m) | metros |
| Malhas idênticas sem instância | 70 de 186 (3 milhões de triângulos repetidos) | — |
| Paisagismo (árvores, arbustos, fontes, mobiliário) | **4,27 milhões de triângulos (92%)** | o jogo tem árvores próprias |
| Arquitetura | 390 mil triângulos | — |
| Tamanho real | 86 × 89 m de base, 275 m de altura (mais 7,7 m de fundação) e 2 torres com pódio | lote comum: até ~2.600 m², gabarito de 160 m |

**Sem tratamento, é inviável:** sozinho, ele pesaria mais que toda a cidade, travaria o celular por memória e levaria minutos para baixar.

### 13.2 Depois do preset SCC ([tools/scc-optimize](../tools/scc-optimize/README.md))

| | Original | LOD0 | LOD1 | LOD2 |
|---|---:|---:|---:|---:|
| Arquivo | 413 MB | **3,3 MB** | 0,44 MB | 0,20 MB |
| Triângulos | 4,66 mi | 304 mil | 77 mil | 12 mil |

Processamento: cerca de 6 segundos. O que funcionou: remover o paisagismo pelo material, centímetros para metros, `dedup` + `instance` (52 instâncias), `weld`, `join`, simplificação (sem UVs no LOD0; sem normais e UVs nos LODs 1 e 2) e meshopt.

Medido no protótipo (Chrome, desktop): **60 FPS com e sem a torre**. A torre acrescenta ~95 mil triângulos visíveis no quadro e ~120 chamadas de desenho; de longe entram os LODs 1 e 2. Área construída calculada por corte de cada andar: **113 mil m²**, com andar típico de ~1.160 m², 88 andares e cerca de 690 unidades de ~119 m² com 8 por andar.

### 13.3 Regras novas para prédios grandes (já no protótipo)

| Regra | Valor |
|---|---|
| Tamanho máximo por envio ao jogo | 40 MB (acima disso, otimize antes no SCC Builder) |
| Mais de 150 mil triângulos | Exige os 3 LODs (envie `-lod0`, `-lod1` e `-lod2` juntos) |
| Orçamento do LOD0 | 300 mil (comum) / **450 mil para torre-marco** |
| **Megaempreendimento (superquadra-marco)** | Remembramento de 4 quadras; ruas internas viram praça; gabarito de 320 m, coeficiente 4, recuo de 8 m; exige comprar todos os lotes da superquadra (no protótipo, 24 lotes = 174 mil SCITY), leilão da Prefeitura e alvará especial; **no máximo 1 por região** |
| Área construída | Calculada por corte real de cada andar; o excedente ao coeficiente paga outorga onerosa |

Com essas regras, o `edificio.glb` otimizado **passa em todas as checagens** na superquadra e é publicável: 690 unidades, sem outorga.

### 13.4 Atenção: direitos sobre o modelo

Os nomes internos (`Archexterior10_04_*`, materiais `archmodels58_*`) indicam uma cena da biblioteca comercial **Evermotion Archexteriors vol. 10**. Licenças desse tipo costumam permitir uso em renderizações, mas **proibir a redistribuição dos modelos em jogos, apps e NFTs**. Este modelo serve para teste interno, mas não deve ser publicado no jogo nem versionado no repositório sem uma licença que permita. O alvará (moderação, §4) precisa checar a origem dos modelos enviados.
