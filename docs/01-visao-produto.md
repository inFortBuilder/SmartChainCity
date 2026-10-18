# 01 — Visão do Produto

## 1. Proposta

**Smart Chain City (SCC)** é uma cidade virtual persistente, jogável no navegador (Unity WebGL) e acessível por espaços de metaverso, onde o jogador:

1. adquire um **smartcityano** (avatar-NFT) por meio de uma Lucky Box;
2. trabalha numa **profissão** e ganha THALER em ciclos de trabalho automáticos (minigames);
3. compra **lotes** e constrói/compra **imóveis virtuais** (residenciais, comerciais, industriais, rurais);
4. abre **negócios** (mercado, fast food, oficina, posto, fazenda, hotel...) e participa de uma economia entre jogadores;
5. negocia ativos no **marketplace** e converte THALER ↔ SCITY.

A cidade é organizada como uma cidade real: Prefeitura no centro, zoneamento, infraestrutura (água/energia), impostos, transporte, estações do ano e desastres naturais.

## 2. Objetivos da plataforma

| Objetivo | Indicador |
|----------|-----------|
| Replicar uma cidade navegável e viva no navegador | Cidade carregando em < 20 s em banda de 20 Mbps; 30+ FPS em notebook médio |
| Mercado de imóveis virtuais com posse verificável | 100% dos lotes/imóveis como NFTs com histórico on-chain |
| Economia sustentável (evitar o colapso típico de P2E) | Razão sinks/faucets ≥ 0,9 medida semanalmente; payback-alvo controlado |
| Ambiente social / metaverso | Presença multiplayer por célula, eventos ao vivo, espaços no Spatial |
| Abertura para marcas reais | Lojas e eventos patrocinados dentro da cidade (GDD §3.30) |

## 3. Público

- **Jogador casual/idle**: quer progresso sem ficar o dia todo jogando — o ciclo de trabalho roda sozinho (GDD §3.2).
- **Jogador estratégico/empreendedor**: otimiza ROI de pets, fazendas, imóveis e cadeias produtivas.
- **Investidor/colecionador**: compra lotes centrais, imóveis raros (Residencial 1 e 2) e avatares lendários.
- **Marcas e parceiros**: ativação dentro do jogo (lojas, eventos, patrocínios).

O benchmark da FGV Jr. mostra que a comunidade P2E brasileira é a maior presença internacional em jogos como Mobox — o lançamento deve ser **PT-BR primeiro**, com i18n preparado (o Strapi já usa o plugin `i18n`).

## 4. Pilares de design

1. **Vida urbana simulada** — atributos (energia, saúde, felicidade, educação, alimentação) dirigem o rendimento.
2. **Propriedade real** — lotes, imóveis, avatares e veículos são ativos do jogador.
3. **Economia com freios** — toda emissão tem um gasto correspondente (combustível, IPVA, IPTU, reparos, hospital, seguros).
4. **Cidade que cresce** — mapa começa limitado e se expande por regiões em lotes planejados.
5. **Eventos constantes** — eventos semanais por profissão e temporadas festivas, aprendizado do RiseCity e Mafagafo.

## 5. Lições do benchmark (FGV Jr., cap. 2)

| Jogo | Lição aplicada no SCC |
|------|-----------------------|
| FarmPoly | Itens grátis de teste; duas moedas com câmbio de saída menor que o de entrada |
| CryptoCars | Queima via combustível, emplacamento e peças; *risco*: rug pull destruiu a confiança |
| Axie Infinity | Liberação gradual do supply máximo |
| Mafagafo | GamePass como sink; itens sazonais colecionáveis |
| Illuvium | Segurança é existencial; staking reduz circulação |
| Bombcrypto | Tokens da equipe travados ≥ 1 ano geram confiança |
| Plants vs Undead | Falta de comunicação com a comunidade derruba o token |
| RiseCity | Eventos festivos; VIP com seguro contra destruição; evitar jogo "passivo" |
| MouseHaunt | Raridades + dois tokens (um finito/deflacionário, um infinito/inflacionário) |

## 6. Inventário do que já existe

| Ativo | Estado | Aproveitamento |
|-------|--------|----------------|
| **Unity WebGL `scc_web` v0.0.23** (out/2023, empresa "UZAACOM") | Cenas `ShowcaseLogin`, `ShowcaseSelectAvatar`, `SelectWorlds`, `ShowcaseCity`; Addressables; prefabs `CityBuilder` (Lot, Beach, Bridge, Park, Water), `Properties/T1`; avatar 2D masculino (pele, cabelo, roupas de profissão); janelas de UI (Credentials, Alert, Error...) | Base visual e de UX. **O projeto-fonte Unity não está na pasta** — só o build. Recuperar o repositório é pré-requisito (ver doc 11). |
| **Strapi 4.4.3** (`Strapi-main`) | 16 content-types: avatar, job, activity, food, land, coordinate, rarity, property, property-type, property-level, wallet, conversion, conversion-factor, transaction-blockchain, transaction-game, e-mails; MySQL, S3, SendGrid, CI GitLab → Docker | Vira **backoffice/CMS** de catálogos. A lógica de saldo precisa ser reescrita (doc 10). |
| **BackEndStrapi-main** | Apenas README | Descartar. |
| **Spatial SDK template** (`spatial-virtualcamp`, Unity 2021.3.8f1, URP 12) | Exemplos do SDK | Base para showrooms e eventos no Spatial (doc 08). |
| **Site WordPress** (backup Duplicator, 2022–2023) | Landing page, parceiros, equipe | Referência de marca; nova landing deve ser estática. |
| **Arte** | 12 cards de profissões, logo, moeda | Guia de estilo. |
| **Estudos FGV Jr.** | GDD, tokenomics, planilha | Fonte principal das docs 02–04. |
