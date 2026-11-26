# Estado do jogo e próximas etapas

Retrato em 2026-11-22: o que já dá para jogar, o que falta no jogo e a ordem sugerida para as próximas etapas. O detalhe de cada item fica no [ROADMAP](../ROADMAP.md) e nos READMEs dos serviços. O caminho até a mainnet, que depende de pessoas de fora, está no [checklist de lançamento](lancamento.md).

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
| Imóveis (Casa T1, obra, desgaste, renda, reparo, nível) e prédios de construtores (SCC Builder) | 🟡 só a Casa T1 com valores | world |
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

O GDD amarra o ganho do turno à moradia: sem regularização, o imóvel rende metade. Hoje só a Casa T1 existe com valores.

| Falta | Quem | Observação |
|---|---|---|
| ⬜ **Aluguel e hotel:** quem não tem casa paga para morar; o dono do prédio ou do hotel recebe | 🔧 | GDD §3; o `fator_regularizacao_moradia` (doc 04 §4) entra no turno |
| ⬜ **Regularização do lote** na Prefeitura (residencial ou comercial) e **água e energia** contratadas, com custo pela distância | 🔧 | doc 03 §4: imóvel sem regularização rende 50% |
| ⬜ **Troca de tipo** T1 → T2 → T3, Residencial 2 e 3 (lote duplo) e os outros tipos do doc 03 §6 | 🔧 👤 | Os valores vêm da "Figura 16" do GDD, que não veio no texto (doc 11, lacuna 3) |
| ⬜ **Seguro** do imóvel | 🔧 👤 | Faltam regra e preço |
| ⬜ **Catálogo de imóveis no Strapi** (hoje fica no código, igual ao seed) | 🔧 | O tipo `property-type` já existe no CMS |
| ⬜ **Prédios: unidades e venda** (E3.11), taxa de alvará, prazo de obra pela área, IPTU por unidade, `BuildingNFT` lido pelo indexer | 🔧 | doc 13 |

### 2.2 Avatar e trabalho

| Falta | Quem | Observação |
|---|---|---|
| ⬜ **Descansar e atividades do dia a dia**, que sobem os atributos (o seed tem as atividades do GDD §4.5) | 🔧 👤 | O GDD só dá a direção do efeito; os números saem do game designer |
| ⬜ **Deslocamento** (carro, skate, ônibus, a pé, home office), com custo e tempo | 🔧 👤 | GDD §2 |
| ⬜ **Bônus de itens no ganho** (roupas 1,10/1,15/1,20 e ferramentas temporárias) e **loja de itens** | 🔧 👤 | doc 04 §4; os itens da temporada já entram |
| 🟡 **Energia e felicidade reais por tarefa** do minigame | 👤 | Hoje o turno gasta a energia pelo total; os números por tarefa são do game designer |
| ⬜ **Limite da despensa pela casa** e tempo de compra no mercado | 🔧 | game-core, "Ainda não" |

### 2.3 Cidade, multiplayer e eventos

| Falta | Quem | Observação |
|---|---|---|
| ⬜ **Agendador de eventos ao vivo** (o dirigível 3 vezes ao dia já chama o broadcast, mas não tem agenda) | 🔧 | realtime |
| ⬜ **Presença no Redis** para vários processos (hoje cada processo tem o seu matchmaker; o shard por bairro já divide a carga) e **silenciamentos guardados em banco** | 🔧 | Redis seria um serviço a mais na máquina local |
| ⬜ **Eventos de data marcada** (Natal, Carnaval) | 🔧 👤 | E3.10 |
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
- **alertas do painel econômico:** os limites de partida.

### 2.6 Técnico

| Falta | Quem | Observação |
|---|---|---|
| ⬜ Fila de jobs (BullMQ) | 🔧 | Hoje os jobs rodam no próprio processo de cada serviço. Basta enquanto houver uma instância |
| ⬜ `openapi.yaml` dos serviços | 🔧 | Documentação pública da API |
| ⬜ Staging e produção na nuvem (IaC, CDN, Sentry) | 👤 🔧 | Fora do MVP local sem custo; entra no [checklist](lancamento.md#fase-2-ensaio-completo-na-testnet-bsc-97) |
| ⬜ Teste de carga com o gerador em outra máquina | 👤 | E3.9 |
| ⬜ `StakingPool` | 🔧 👤 | Precisa de rodada própria de auditoria; até lá, o staking fica no Safe com vesting |

## 3. Próximas etapas sugeridas

A ordem prioriza o que deixa o jogo **completo para o jogador** no lançamento da A1. Em paralelo, segue o que depende de pessoas de fora.

1. **Calibrar a economia** 👤 (com 🔧 para aplicar). Sem os números definitivos, todo o resto é provisório. O game designer roda o simulador com as premissas acima; o código só troca constantes e o seed do Strapi.
2. **Moradia completa** 🔧, o maior buraco do laço do jogador:
   - aluguel e hotel;
   - regularização na Prefeitura;
   - água e energia;
   - o fator de moradia no turno.
3. **Descansar, atividades e deslocamento** 🔧 👤: fecham o dia do avatar (trabalhar → comer → descansar → se divertir → ir e voltar).
4. **Tipos de imóvel e catálogo no Strapi** 🔧 👤: T2, T3, os residenciais e os comerciais, com os valores da Figura 16 quando o game designer fechar.
5. **Bônus de itens e loja** 🔧 👤: roupas, ferramentas e os itens de temporada à venda.
6. **Arte** 👤: profissões, pets, Lucky Box e trailer. Não bloqueia o código, mas bloqueia o lançamento.
7. **Prédios com unidades e venda** (E3.11) 🔧: o mercado dos construtores.
8. **Agendador de eventos ao vivo** 🔧, depois os eventos de data marcada.

**Em paralelo, fora do código**, na ordem do [checklist de lançamento](lancamento.md):
- parecer jurídico;
- auditoria;
- Safes, KMS e VRF;
- ensaio na testnet;
- TGE;
- venda da A1.

## 4. Como manter este documento

Ao fechar um item, troque o estado aqui e no ROADMAP no mesmo PR. Itens novos entram na seção do sistema, com quem faz. Quando uma premissa virar valor definitivo, saia da lista do §2.5.
