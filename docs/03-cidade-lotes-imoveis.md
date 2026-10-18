# 03 — Cidade, Lotes e Imóveis Virtuais

Este documento define o **modelo espacial** da cidade (a base do metaverso) e o **mercado de imóveis virtuais**.

---

## 1. Hierarquia espacial

Regra do GDD (§3.3.1): todo lote é 1×1; 4 lotes = slot; 9 slots = célula; 9 células = bairro; 9 bairros = região.

| Unidade | Composição | Dimensão em lotes | Nº de lotes |
|---------|------------|-------------------|------------:|
| **Lote** | — | 1 × 1 | 1 |
| **Slot** | 2 × 2 lotes | 2 × 2 | 4 |
| **Célula** | 3 × 3 slots | 6 × 6 | 36 |
| **Bairro** | 3 × 3 células | 18 × 18 | 324 |
| **Região** | 3 × 3 bairros (81 células) | 54 × 54 | 2.916 |

```
Região (54×54)
┌────────┬────────┬────────┐
│ Bairro │ Bairro │ Bairro │   Bairro (18×18)
├────────┼────────┼────────┤   ┌──────┬──────┬──────┐
│ Bairro │ Bairro │ Bairro │   │Célula│Célula│Célula│   Célula (6×6)
│        │ (0,0)  │        │   ├──────┼──────┼──────┤   ┌──┬──┬──┐
├────────┼────────┼────────┤   │Célula│Célula│Célula│   │S │S │S │  Slot = 2×2 lotes
│ Bairro │ Bairro │ Bairro │   ├──────┼──────┼──────┤   ├──┼──┼──┤
└────────┴────────┴────────┘   │Célula│Célula│Célula│   │S │S │S │
                               └──────┴──────┴──────┘   └──┴──┴──┘
```

**Escala no mundo 3D:** 1 lote = **10 m × 10 m** (recomendado). Uma região = 540 m × 540 m. Ruas ocupam a faixa entre células (recomendado: 1 lote de largura por rua entre células, fora da contagem de lotes vendáveis).

---

## 2. Sistema de coordenadas

- Coordenadas inteiras **(x, y)** por lote, globais e únicas.
- A **Prefeitura** fica em **(0,0)**, no centro da região **A1** (GDD §3.3.2).
- A região A1 ocupa x, y ∈ [−27, 26].

Funções de derivação (usadas no cliente, no servidor e nos metadados NFT):

```ts
const LOT_PER_SLOT = 2, LOT_PER_CELL = 6, LOT_PER_HOOD = 18, LOT_PER_REGION = 54;
const HALF = 27; // centraliza A1 em (0,0)

const floorDiv = (a: number, b: number) => Math.floor(a / b);

export function locate(x: number, y: number) {
  const gx = x + HALF, gy = y + HALF;           // origem no canto da A1
  return {
    region: { rx: floorDiv(gx, LOT_PER_REGION), ry: floorDiv(gy, LOT_PER_REGION) },
    hood:   { hx: floorDiv(gx, LOT_PER_HOOD),   hy: floorDiv(gy, LOT_PER_HOOD) },
    cell:   { cx: floorDiv(gx, LOT_PER_CELL),   cy: floorDiv(gy, LOT_PER_CELL) },
    slot:   { sx: floorDiv(gx, LOT_PER_SLOT),   sy: floorDiv(gy, LOT_PER_SLOT) },
  };
}
```

**Nome das regiões:** o GDD usa A1 (centro) e A3 (rural, "afastada do centro"). Proposta: anel de distância de Chebyshev ao centro → letra do anel + índice.
- `A1` = região (0,0).
- `A2` = anel 1 (8 regiões ao redor, urbanas/suburbanas).
- `A3` = anel 2 (16 regiões; zona rural, mineração, usinas).
- Regiões futuras recebem anéis seguintes e/ou novas "cidades" (metaversos irmãos citados em GDD §3.5).

O **ID do token** de um lote é derivado deterministicamente das coordenadas (em Solidity, `uint256`; no TypeScript, usar `BigInt`): `tokenId = (uint256(uint32(x)) << 32) | uint32(y)` (x e y como `int32`, reinterpretados em complemento de dois) — impede duplicidade e permite consultar a posse por coordenada.

---

## 3. Zoneamento

| Zona | Onde | Usos permitidos |
|------|------|-----------------|
| **Cívica** | Célula central de A1 | Prefeitura, banco, hospital central (do jogo) |
| **Comercial** | A1 e eixos de A2 | Lojas, mercados, fast food, hotéis, galerias |
| **Residencial** | A1/A2 | Casas T1–T3, Residenciais 1–3 |
| **Industrial** | A2 externa / A3 | Indústrias, postos, usinas |
| **Rural** | A3 | Fazendas (mín. 1 slot) |
| **Mineração** | 20% dos lotes, distribuídos por sorteio na geração da região | Extração com licença |
| **Água / orla** | Hidrovias e praias (prefabs `Beach`, `Water`, `Bridge` já existem no build) | Portos, pesca, navios |

Após comprar o imóvel, o lote deve ser **regularizado** na Prefeitura (residencial ou comercial); imóvel em lote sem regularização rende **50%**.

---

## 4. Regras de posse

| Regra | Implementação |
|-------|---------------|
| Máx. **1 bairro por jogador por região** | Validação no servidor e no contrato de venda primária: contagem de lotes do dono por região ≤ 324 e todos no mesmo bairro |
| Proibido **cercar** o lote de um terceiro | Na compra, verificar os 8 vizinhos de cada lote de terceiros adjacente; rejeitar se o comprador passaria a deter todos |
| Venda primária a **preço fixo por região** (mais caro no centro) | Tabela `region_price`; preço decrescente por anel |
| Venda secundária livre | Marketplace (doc 07) |
| **PT — Property Tax** | Lote vazio: imposto crescente a cada mês sem uso. Lote com imóvel: taxa menor e fixa. Inadimplência → multa → leilão após N ciclos (proposto: 3 meses) |
| Imóvel sobre lote de terceiros é proibido | Vender o imóvel antes do lote, ou vender em **combo** (lote + imóvel) |
| Infraestrutura | Lote vem **sem água e energia**; contratar serviço; custo cresce com a distância ao centro |
| Felicidade de vizinhança | Mais moradores na região/bairro → mais felicidade; desestimula lotes isolados |

---

## 5. Expansão do mapa

- O mapa nasce com **A1 + parte de A2** (proposto: A1 + 4 regiões = 14.580 lotes).
- Novas regiões são liberadas **em lote**, em datas anunciadas, conforme ocupação (gatilho proposto: > 70% dos lotes vendidos no anel atual).
- Cada expansão é um evento de marketing e um *sink* de SCITY (venda primária).

---

## 6. Imóveis virtuais

### 6.1 Tipos residenciais (GDD §3.4)

| Tipo | Lotes | Disponibilidade | Uso |
|------|------:|-----------------|-----|
| **T1** | 1 | Sempre | Casa; rendimento diário |
| **T2** | 1 | Sempre (upgrade de T1) | Casa |
| **T3** | 1 | Sempre (upgrade de T2) | Casa + pequeno negócio com renda extra |
| **Residencial 1** | 1 | **Raro** — apenas em eventos | Edifício; aluga unidades |
| **Residencial 2** | 2 (lote duplo) | **Raro** — apenas em eventos | Edifício |
| **Residencial 3** | 2 (lote duplo) | Sempre | Edifício |

Capacidade de moradores e custos: **⚠** a tabela "Figura 16" do GDD não veio no texto extraído — ver doc 11.

### 6.2 Tipos comerciais, industriais e rurais
Mercado (N1–N3), fast food, restaurante, loja (roupas, calçados, móveis), farmácia, pet shop, oficina, academia, galeria, hotel (N1–N3), posto, indústria (por setor), usina, casa de fazenda, galinheiro, chiqueiro, curral, pasto.

Imóveis comerciais vêm prontos e são **mais caros** que os residenciais.

### 6.3 Ciclo de vida de um imóvel

```
Comprar/Construir ─► Alocar em lote ─► Regularizar na Prefeitura ─► Ligar água/energia
        │                                                           │
        ▼                                                           ▼
   Tempo de obra (build_hours/min/sec — já no Strapi)          Gera renda (claim)
                                                                    │
                    Desgaste (wear 100→0)  ◄────────────────────────┤
                    Desastre / assalto (prob. por estação e local)  │
                    Seguro reduz perdas · Reparador restaura         │
                    Upgrade de nível (1→3, upgrade_cost)             ▼
                                                         Vender (separado ou combo)
```

- **Desgaste:** campo `wear` (0–100) do Strapi; renda × `wear/100`; abaixo de 30 o imóvel para de render.
- **Desastres:** probabilidade por estação; **assaltos** por localização. Quanto melhor o lote/imóvel, maior a probabilidade (planilha) — é um sink planejado.
- **Seguro** no Banco Smart Chain, preço por tipo de imóvel.

### 6.4 Imóvel como NFT
Cada imóvel é um ERC-721 com metadados dinâmicos:

```json
{
  "name": "Residencial 3 — Bairro A1-4, Célula 22",
  "attributes": [
    {"trait_type": "Tipo", "value": "Residencial 3"},
    {"trait_type": "Nível", "value": 2},
    {"trait_type": "Região", "value": "A1"},
    {"trait_type": "Coordenada", "value": "12,-4"},
    {"trait_type": "Lotes", "value": 2},
    {"trait_type": "Desgaste", "value": 87, "display_type": "number"},
    {"trait_type": "Regularizado", "value": "Residencial"}
  ],
  "image": "https://cdn.smartchaincity.../properties/res3-l2.png",
  "animation_url": "https://cdn.smartchaincity.../viewer?property=…"
}
```

Atributos que mudam muito (desgaste, renda) ficam **off-chain** e são servidos pela API de metadados; o contrato guarda apenas tipo, nível e vínculo ao lote.

---

## 7. Replicar uma cidade real

O pedido de "um ambiente que replique uma cidade" pode ser atendido em três níveis — recomenda-se começar pelo **Nível 1** e evoluir.

| Nível | Descrição | Como |
|-------|-----------|------|
| **1 — Cidade estilizada inspirada** | Grade SCC com marcos inspirados em uma cidade real (ex.: avenida, orla, parque) | Modelagem manual com os prefabs `CityBuilder`; layout desenhado sobre a grade |
| **2 — Traçado real projetado na grade** | Ruas, quarteirões, rios e áreas verdes vêm do **OpenStreetMap** e são "encaixados" na grade de lotes | Pipeline offline: extrair OSM (Overpass) → projetar em metros (UTM) → rasterizar em lotes de 10 m → classificar zona (rua / água / verde / edificável) → exportar JSON por célula → gerar a cena por Addressables |
| **3 — Gêmeo digital fotorrealista** | Vitrine com prédios reais em 3D | 3D Tiles (Cesium / Google Photorealistic 3D Tiles). **Atenção:** verificar suporte do Cesium for Unity ao alvo WebGL e as licenças de uso comercial do Google antes de adotar; alternativa é uma página web separada com CesiumJS para o "tour" e o jogo continuando na grade estilizada |

Recomendações para o Nível 2:
- O OSM é licenciado sob **ODbL** — exibir atribuição "© OpenStreetMap contributors" e manter derivados de dados compartilháveis.
- A grade do jogo continua sendo a fonte da verdade de posse; o traçado real apenas define **quais lotes existem** e qual é o uso.
- Lotes reais **não** representam propriedade real; deixar isso explícito nos Termos de Uso (evita confusão com imóveis físicos).
- Para parcerias com incorporadoras reais (GDD §3.30): "showroom" virtual de um empreendimento real como imóvel comercial patrocinado, sem vínculo jurídico com o imóvel físico.

### 7.1 Formato de dados de célula (saída do pipeline)

```json
{
  "cell": {"cx": 4, "cy": 4},
  "region": "A1",
  "lots": [
    {"x": -3, "y": 0, "use": "buildable", "zone": "residential", "mineable": false},
    {"x": -2, "y": 0, "use": "road"},
    {"x": -1, "y": 0, "use": "water"}
  ],
  "props": [{"prefab": "Park/Park 2", "x": 0, "y": 2, "rot": 90}],
  "addressableKey": "cell_A1_4_4"
}
```
