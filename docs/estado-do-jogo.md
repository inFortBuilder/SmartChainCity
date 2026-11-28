# Estado do jogo e próximas etapas

Retrato em 2026-11-22, atualizado em 2026-11-26 (moradia, descanso, deslocamento, catálogo de imóveis, loja, unidades dos prédios e agenda de eventos): o que já dá para jogar, o que falta no jogo e a ordem sugerida para as próximas etapas. O detalhe de cada item fica no [ROADMAP](../ROADMAP.md) e nos READMEs dos serviços. O caminho até a mainnet, que depende de pessoas de fora, está no [checklist de lançamento](lancamento.md).

**Legenda:**
- ✅ pronto e testado;
- 🟡 funciona, mas com valores provisórios (premissas) ou partes faltando;
- ⬜ não começou.

**Quem faz:**
- 🔧 dá para fazer no repositório;
- 👤 depende de alguém de fora do código (game designer, artista, jurídico, auditoria, operação).

## 1. O que já dá para jogar

Tudo roda na máquina local, sem serviços pagos. O mapa da cidade real (Pittsburg) é o cliente do jogo: o mapa 3D, o street view e o painel "Jogo no servidor".

| Sistema | Estado | Onde |
|---|---|---|
| Conta: carteira (SIWE) ou e-mail, captcha, KYC no saque | ✅ | [gateway](../services/gateway/README.md) |
| Avatar, atributos e queda com o tempo; turno de 6 ou 12 h com minigame e semente auditável | ✅ 🟡 | [game-core](../services/game-core/README.md) |
| Comer, despensa, farmácia, doenças e hospital | 🟡 preços e chances provisórios | game-core |
| Ledger de THALER e SCITY, câmbio com TWAP, painel econômico | ✅ 🟡 limites de alerta provisórios | [economy](../services/economy/README.md) |
| Lotes (compra, um bairro por jogador, teto de área), venda de lançamento com fila | ✅ | [world](../services/world/README.md) |
| Imóveis (obra, desgaste, renda, reparo, nível, troca de tipo T1 → T2 → T3) com o catálogo do Strapi, e prédios de construtores (SCC Builder) | 🟡 T1, T2, T3, academia e galeria com valores provisórios | world e [CMS](../cms-strapi/README.md) |
| Regularização na Prefeitura, água e energia (sem elas, renda de 50%) | ✅ 🟡 custos provisórios | world |
| Moradia do avatar: casa própria regular, aluguel ou hotel com refeições (sem moradia, turno de 50%) | ✅ 🟡 preços provisórios | game-core e world |
| Descanso (dormir 4 ou 8 h), higiene em casa e o modo de ir ao trabalho (atraso e tarifa no turno) | ✅ 🟡 efeitos provisórios | game-core |
| Loja do jogo: roupas (+10/15/20%), ferramenta de trabalho (+30% por 3 dias) e cama (2º turno de 6 h) | ✅ 🟡 preços provisórios | game-core |
| Unidades dos prédios: venda primária, revenda com royalty e aluguel para morar (fora da blockchain) | ✅ 🟡 taxas provisórias | world e game-core |
| Impostos (IPTU e lote vazio), multa, leilão do lote inadimplente com apreensão do NFT | 🟡 valores provisórios | world |
| Pets, Pet Shop e Pet Sitter | 🟡 falta a arte | game-core |
| Escola e troca de profissão | ✅ 🟡 preços provisórios | game-core |
| Lazer: parque, academia e galeria de jogador, campeonato de futebol de botão | ✅ | game-core e world |
| Fazenda: lavoura e pecuária | ✅ 🟡 | game-core |
| Veículos: autoescola, agência, IPVA, corridas, oficina | ✅ 🟡 | game-core |
| Eventos semanais e GamePass com itens sazonais (no Strapi) | ✅ 🟡 efeitos provisórios | game-core e [CMS](../cms-strapi/README.md) |
| Multiplayer por bairro: presença, chat moderado e jogadores andando no street view | ✅ | [realtime](../services/realtime/README.md) |
| Blockchain: lote, imóvel, prédio e avatar como NFT; Lucky Box com VRF; GameVault (depósito e saque); Marketplace (preço fixo, combo e leilão); TGE | ✅ no anvil e na testnet local | [contratos](../contracts/README.md) |
| Site: números reais, login, depósito, marketplace, FAQ, contratos oficiais | ✅ | [website](../website/README.md) |
| Operação: plano de incidentes, travas, lotes do Safe, ensaio do lançamento no CI | ✅ | [incidentes](incidentes/README.md) |

**Para rodar o jogo:**
- os quatro serviços: gateway 8000, economy 8010, game-core 8020 e world 8030;
- o realtime (8050) e as telas (8081): `http://localhost:8081/docs/proposta-cidade-realista/pittsburg.html`;
- opcionais: o chain-indexer (8040), para depósito e mercado on-chain, e o Strapi (1337), para editar o catálogo. Sem o Strapi, vale o seed.

## 2. O que falta no jogo

### 2.1 Moradia e imóveis (o laço principal do jogador)

O GDD amarra o ganho do turno à moradia. Já funcionam a regularização, água e energia (sem elas, o imóvel rende metade) e a moradia do avatar: casa própria regular, aluguel no residencial da Prefeitura ou hotel do jogo (sem moradia, o turno rende metade). Hoje só a Casa T1 existe com valores.

| Falta | Quem | Observação |
|---|---|---|
| ✅ **Hotel de jogadores:** a diária vai para o dono (90%), com quartos por nível. O aluguel de unidade de jogador também já funciona | 🔧 | Preço da obra e quartos provisórios |
| 🟡 **Tipos de imóvel:** a troca T1 → T2 → T3 e o catálogo do Strapi já funcionam; faltam os valores dos outros tipos do doc 03 §6 (o Strapi os mostra como "aguardando") e o lote duplo (Residencial 2 e 3) | 👤 🔧 | Os valores vêm da "Figura 16" do GDD, que não veio no texto (doc 11, lacuna 3) |
| ⬜ **Seguro** do imóvel | 🔧 👤 | Faltam regra e preço |
| 🟡 **Prédios:** as unidades se vendem e se alugam no jogo; o `UnitNFT` e o `UnitMarket` estão escritos e testados (falta a auditoria e o world assinar o voucher); faltam taxa de alvará, prazo de obra pela área, IPTU por unidade e condomínio. O chain-indexer já lê o `BuildingNFT`, o `UnitNFT` e o `UnitMarket` | 🔧 👤 | doc 13 |

### 2.2 Avatar e trabalho

| Falta | Quem | Observação |
|---|---|---|
| 🟡 **Calçados e roupas sazonais** | 🔧 👤 | GDD §6 "Lojas". Roupas, ferramenta, cama, móveis (casa completa +1 de felicidade) e eletrodomésticos (cozinhar) já estão na loja do jogo |
| 🟡 **Energia e felicidade reais por tarefa** do minigame | 👤 | Hoje o turno gasta a energia pelo total; os números por tarefa são do game designer |

### 2.3 Cidade, multiplayer e eventos

| Falta | Quem | Observação |
|---|---|---|
| ✅ **Agenda de eventos ao vivo:** dirigível 3 vezes ao dia com o evento da semana e o anúncio do Ano Novo, Carnaval e Natal | 🔧 | realtime; faltam os anúncios pagos de jogadores (fase 2) |
| ⬜ **Presença no Redis** para vários processos (hoje cada processo tem o seu matchmaker; o shard por bairro já divide a carga). Os silenciamentos já ficam no Postgres e valem em todos os processos | 🔧 | Redis seria um serviço a mais na máquina local |
| 🟡 **Eventos de data marcada** (Natal, Carnaval): o anúncio já sai pela agenda; faltam os efeitos de jogo (itens e bônus da data) | 👤 🔧 | E3.10 |
| ⬜ **Espaços Spatial**: stand de vendas, Prefeitura Virtual e showroom | 👤 | E4.4; plataforma externa |
| ⬜ **Live Ops** em ondas: anel A2, franquias e food trucks, mineração e combustível, energia, staking, transporte, marcas, mobile e idiomas | 🔧 👤 | Etapa 5 do ROADMAP; cada onda só abre com o painel econômico saudável |

### 2.4 Arte e apresentação

| Falta | Quem |
|---|---|
| ⬜ Cards de arte das 12 profissões do MVP, arte dos pets e dos itens, tela de abertura da Lucky Box | 👤 artista |
| ⬜ Trailer, vídeo do tutorial e imagens do site | 👤 |
| 🟡 Interiores dos imóveis e prédios (há um escritório de exemplo e a visita pelo street view) | 👤 🔧 |

### 2.5 Economia: premissas a calibrar

Os valores abaixo funcionam no jogo, mas são **premissas** marcadas no código. Eles precisam do game designer com o simulador (`tools/econ-sim`) antes do lançamento (E0.4 e [doc 11](11-decisoes-pendentes.md)):
- **preços:** alimentos, Pet Shop, Pet Sitter, escola, veículos e imóveis;
- **chances:** doenças e riscos da fazenda;
- **queda de alimentação do pet:** 1 a cada 6 h; o GDD diz 1 por hora, o que mata o pet no meio de um turno;
- **evento semanal:** fator de 1,2 e o grupo "Cidade", que o GDD não define;
- **GamePass:** 5 SCITY por nível, o corte de dano e os efeitos dos itens;
- **antifraude:** limites de contas por aparelho e de velocidade;
- **câmbio:** teto e spread;
- **descanso e deslocamento:** +4/+8 de energia (metade sem moradia), efeitos da higiene, atrasos de ônibus e a pé, tarifas (ônibus 3, combustível 2, internet 2) e o home office; o cochilo de 4 h também zerar as 16 h acordado;
- **unidades:** taxa de 5% na venda primária, royalty de 2% e taxa de 10% no aluguel;
- **hotel de jogador:** obra de 9.000 THALER, níveis por 5.000 e 9.000, 10/20/40 quartos e 90% da diária ao dono;
- **mercado e despensa:** compra de 4 min + 30 s por unidade; despensa de 10, 30 e 60 unidades (sem casa, com casa, com geladeira);
- **skate:** 120 THALER e 60 viagens (a "depreciação" do GDD);
- **móveis e cozinha:** sofá 200, mesa 150, guarda-roupa 180, fogão 300, geladeira 400 e micro-ondas 150 THALER; +1 de felicidade ao acordar com a casa completa; cozinhar +5/+4 e +1 de saúde com geladeira;
- **loja:** preços das roupas, da ferramenta e da cama, e a ferramenta genérica por profissão;
- **imóveis:** preço, renda e níveis da T2 e da T3;
- **moradia:** aluguel de 15 THALER/dia (40% queima, 60% de volta ao pool P2E) e hotel de 25, 40 e 60 THALER/dia, com 1, 2 e 3 refeições;
- **Prefeitura e serviços:** taxa de regularização de 2% do preço, água e energia (2 e 3 THALER/dia no centro, até o dobro na borda);
- **alertas do painel econômico:** os limites de partida.

### 2.6 Técnico

| Falta | Quem | Observação |
|---|---|---|
| ✅ Jobs com várias instâncias | 🔧 | `JobRunner` do `@scc/shared`: com advisory lock do Postgres, uma só instância roda cada passada. Tem métricas por job e desligamento limpo. Sem Redis: os jobs são varreduras idempotentes. BullMQ só se surgir trabalho por mensagem |
| ✅ `openapi.yaml` dos serviços | 🔧 | Um por serviço, com autenticação, parâmetros, corpos e códigos de erro. O teste `services/shared/test/openapi.test.ts` quebra se uma rota ficar sem documentação. As respostas ainda são `object` genérico |
| ⬜ Staging e produção na nuvem (IaC, CDN, Sentry) | 👤 🔧 | Fora do MVP local sem custo; entra no [checklist](lancamento.md#fase-2-ensaio-completo-na-testnet-bsc-97) |
| ⬜ Teste de carga com o gerador em outra máquina | 👤 | E3.9 |
| ⬜ `StakingPool` | 🔧 👤 | Precisa de rodada própria de auditoria; até lá, o staking fica no Safe com vesting |

## 3. Próximas etapas sugeridas

A ordem prioriza o que deixa o jogo **completo para o jogador** no lançamento da A1. Em paralelo, segue o que depende de pessoas de fora.

1. **Calibrar a economia** 👤 (com 🔧 para aplicar). Sem os números definitivos, todo o resto é provisório. O game designer roda o simulador com as premissas acima; o código só troca constantes e o seed do Strapi.
2. ~~**Moradia completa**~~ ✅ (2026-11-26): regularização, água e energia, aluguel, hotel e o fator no turno. O aluguel e o hotel de jogadores vêm com o item 7.
3. ~~**Descansar, atividades e deslocamento**~~ ✅ (2026-11-26): dormir, higiene em casa e o modo de ir ao trabalho. O descanso obrigatório após 16 h acordado ficou pronto em 2026-11-27. Faltam os números do game designer.
4. ~~**Tipos de imóvel e catálogo no Strapi**~~ ✅ (2026-11-26): o catálogo vem do Strapi e a T1 troca para T2 e T3. Os outros tipos entram sozinhos quando o game designer preencher preço e renda no CMS; o lote duplo ainda falta.
5. ~~**Bônus de itens e loja**~~ ✅ (2026-11-26): roupas, ferramenta de trabalho e cama na loja do jogo, com o bônus no turno. Móveis e eletrodomésticos (casa completa e cozinhar) entraram em 2026-11-27. Calçados e roupas sazonais ficam para depois.
6. **Arte** 👤: profissões, pets, Lucky Box e trailer. Não bloqueia o código, mas bloqueia o lançamento.
7. ~~**Prédios com unidades e venda**~~ ✅ (2026-11-27), no jogo: unidades, venda, revenda e aluguel para morar. Os contratos `UnitNFT`/`UnitMarket` ficaram prontos em 2026-11-27 (venda primária por voucher, royalty de 2% na revenda pelo `Marketplace` e aluguel por período), à espera de uma rodada com auditoria.
8. ~~**Agendador de eventos ao vivo**~~ ✅ (2026-11-27): dirigível 3 vezes ao dia e anúncios das datas marcadas. Os efeitos de jogo das datas (itens e bônus de Natal e Carnaval) esperam o game designer.

**Em paralelo, fora do código**, na ordem do [checklist de lançamento](lancamento.md):
- parecer jurídico;
- auditoria;
- Safes, KMS e VRF;
- ensaio na testnet;
- TGE;
- venda da A1.

## 4. Como manter este documento

Ao fechar um item, troque o estado aqui e no ROADMAP no mesmo PR. Itens novos entram na seção do sistema, com quem faz. Quando uma premissa virar valor definitivo, saia da lista do §2.5.
