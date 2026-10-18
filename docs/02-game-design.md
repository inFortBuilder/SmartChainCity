# 02 — Game Design Document (GDD)

Consolidação do capítulo 3–5 do estudo da FGV Jr., normalizada em regras implementáveis. Valores marcados com **⚠** têm conflito nas fontes e estão listados em [11 — Decisões Pendentes](11-decisoes-pendentes.md).

---

## 1. Loop principal

```
 Lucky Box ─► Smartcityano (raridade + profissão)
                    │
                    ▼
    ┌──── Cuidar dos atributos ◄─────────────────────┐
    │  comer · dormir · lazer · academia · escola    │
    ▼                                                │
 Ir ao trabalho (a pé / skate / carro / home office) │
    ▼                                                │
 Ciclo de trabalho (minigame automático, 6h ou 12h)  │
    ▼                                                │
 Coletar THALER  ──► gastar (comida, moradia, impostos, combustível...)
    │
    └──► investir: lote · imóvel · negócio · pet · veículo · fazenda ──► renda extra
```

**Loop de sessão (5–10 min):** coletar turno → alimentar → repor energia/felicidade → iniciar próximo turno → verificar negócios.
**Loop semanal:** eventos de profissão, troca de estação (a cada 7 dias), impostos e planos de energia.
**Loop de longo prazo:** educação acumulada, expansão de patrimônio, posições em regiões novas.

---

## 2. Smartcityano (avatar)

### 2.1 Aquisição
- Obtido em **Lucky Box**. Para jogar é preciso ao menos 1 avatar.
- A raridade da caixa altera a probabilidade de raridade do avatar (tabela de probabilidades: **⚠** figura do whitepaper não incluída nas fontes).
- Profissão inicial atribuída aleatoriamente dentro da raridade obtida.
- Limite: **até 3 avatares por jogador** (o GDD menciona "por IP"; implementar por conta + antifraude, ver doc 10).
- A raridade **nunca muda**; para outra raridade é preciso outro avatar.

### 2.2 Raridades e ganho base (Tabela de Atributos)

| Raridade | Ganho base/dia (THALER) | Preço do combo (planilha, US$) |
|----------|-------------------------|--------------------------------|
| Comum | 100 – 125 | 150 |
| Raro | 140 – 165 | 200 |
| Épico | 180 – 205 | 250 |
| Lendário | 225 – 250 | 300 |

### 2.3 Atributos

| Atributo | Faixa | Comportamento |
|----------|-------|---------------|
| **Energia** | 0–10 | Gasta em atividades. Alimentação recarrega a cada 8 h; descanso obrigatório após 16 h. 0 = hospital (perde 1 dia). 1 nível = só trabalhar; 2 = trabalhar e lazer; máx = tudo. |
| **Saúde** | 0–10 | Cai com fast food, sedentarismo, home office, doenças. 0 = hospital compulsório (30 THALER). |
| **Felicidade** | 0–10 | Decai com o tempo. Sobe com lazer, compras, pets, casa mobiliada, vizinhança populosa. |
| **Alimentação** | 0–10 | 3 refeições/dia. 48 h sem comer = não gera recompensa (não morre). |
| **Educação / Experiência** | **⚠** 0–100 | Cumulativa, nunca se perde. Escola e atividades educativas. |
| **Higiene** | 0–10 (proposto) | Citada nas atividades extras (banho, piscina); sugerido como modificador de felicidade. |

### 2.4 Multiplicadores (Tabela de Atributos)

| Nível | Saúde | Felicidade | Experiência | Pet (nível) |
|------:|------:|-----------:|------------:|------------:|
| 10 | 1,50× | 2,0× | — | 15 → 1,25× |
| 9 | 1,40× | 1,9× | — | 14 → 1,22× |
| 8 | 1,20× | 1,8× | — | 13 → 1,20× |
| 7 | 1,00× | 1,7× | — | 12 → 1,18× |
| 6 | 0,90× | 1,6× | — | 11 → 1,16× |
| 5 | 0,80× | 1,5× | — | 10 → 1,14× |
| 4 | 0,70× | 1,4× | — | 9 → 1,12× |
| 3 | 0,60× | 1,3× | — | 8 → 1,10× |
| 2 | 0,55× | 1,2× | — | 7 → 1,08× … 3 → 1,00× |
| 1 | 0,50× | 1,0× | — | — |
| Exp. 100 / 50 / 0 | | | 3× / 2× / 1× | |

Fórmula de ganho: ver [04 — Economia §4](04-economia-tokenomics.md#4-fórmula-de-ganho-diário).

> Regra da planilha: **não divulgar ao jogador o ganho exato de atributo de cada atividade** — a UI mostra apenas direção (+/−).

---

## 3. Profissões

44 profissões em 4 raridades. Cada uma tem um minigame (lista de tarefas com custo de energia, ganho de felicidade, duração e THALER).

| Raridade | Profissões |
|----------|-----------|
| **Comum (11)** | Pedreiro · Alfaiate · Padeiro · Agricultor · Enfermeira · Professor · Bombeiro · Motorista · Tosador · Corretor de Imóveis · Recepcionista |
| **Raro (11)** | Construtor · Modelista · Confeiteiro · Pescador · Dentista · Orientador Escolar · Policial · Mecânico · Pet Sitter · Consultor de Imóveis · Garçom |
| **Épico (14)** | Arquiteto · Designer de Acessórios · Cozinheiro · Fazendeiro · Farmacêutico · Coordenador Escolar · Perito · Piloto · Adestrador · Administrador de Condomínio · Concierge · Veterinário · Incorporador · Hoteleiro |
| **Lendário (8)** | Engenheiro Civil · Estilista · Chef · Agrônomo · Médico · Diretor · Delegado · Astronauta |

### 3.1 Exemplo de minigame (dados para o catálogo)

**Pedreiro — 100 THALER, 265 min**

| # | Tarefa | Energia | Felicidade | Duração |
|---|--------|--------:|-----------:|--------:|
| 1 | Analisar máquinas e materiais | −1 | | 30 min |
| 2 | Comprar equipamentos | −1 | +1 | 10 min |
| 3 | Comprar materiais | −1 | +1 | 10 min |
| 4 | Deslocar-se ao trabalho | −1 | +1 | 30 min |
| 5 | Receber ordens do chefe | | | 10 min |
| 6 | Construir a casa | −2 | +3 | 160 min |
| 7 | Receber pagamento | | +2 | 15 min |

Todas as 44 profissões seguem esse formato no GDD original (cap. 4) e devem ser importadas como dados (`job_task`, doc 06), nunca codificadas no cliente.

### 3.2 Regras de emprego
- Emprego garantido; **demissão após 2 semanas sem comparecer**.
- Trabalhar 1 ou 2 vezes por dia: **turno único de 12 h** ou **2 turnos de 6 h** (requer item *cama*).
- O minigame roda **no servidor** — não exige o jogo aberto.
- **Danos** (perdas no turno): desastres, incêndio, roubo no trajeto, ferramenta quebrada, atributos baixos, clima, escassez de material.
- **Bônus**: eventos semanais e itens temporários (ex.: estetoscópio +30% por 3 dias para médico).
- **Trocar de profissão**: 4 dias de escola; +felicidade nos 2 primeiros dias.
- **Home office** (algumas profissões): paga internet, não gasta energia em transporte, perde saúde e felicidade mais rápido.

### 3.3 Deslocamento

| Modo | Atraso para começar a render | Custo |
|------|------------------------------|-------|
| Carro | 4 min | Combustível + depreciação + IPVA |
| Skate / bicicleta | 10 min | Depreciação |
| A pé | maior (proposto: 15 min) | — |
| Táxi / ônibus | proposto: 6 min | Tarifa |
| Home office | 0 | Internet |

---

## 4. Moradia e imóveis
Detalhado em [03 — Cidade, Lotes e Imóveis](03-cidade-lotes-imoveis.md). Resumo: sem imóvel o avatar paga aluguel (edifício residencial) ou hotel; donos de edifícios recebem aluguel.

---

## 5. Sistemas da cidade

| Sistema | Regras-chave | Fase |
|---------|--------------|------|
| **Mercado** | 3 níveis; compra leva 4 min + volume; orgânicos dão saúde. Inicialmente do jogo, depois vendidos por sorteio. | 1 |
| **Fast food** | Recarga rápida em 3 níveis: +20% energia/−10% saúde; +50%/−20%; +80%/−30%. Franquias vendidas a jogadores depois. Custos: insumos, IPTU semestral, salários, transporte. | 1 (jogo) / 2 (jogadores) |
| **Food truck** | Raro, circula pela cidade, difícil de achar, mais barato. Lanches e sorvetes. Venda a jogadores na fase 2 (sem aluguel). | 1 |
| **Restaurante** | Pratos completos. | 2 |
| **Hospital** | Compulsório com saúde 0 ou energia 0; taxa de 30; perde 1 dia. Doenças: febre, enxaqueca, virose (−1 saúde a cada 15 min). | 1 |
| **Farmácia** | Remédio cura com 70% de chance. Dor de barriga 3% após comer (1 dia de cama); gripe 1% (24 h isolado); dor de cabeça −10% rendimento. Exige avatar enfermeiro como dono. | 1 |
| **Escola** | Educação e troca de profissão. | 1 |
| **Lazer** | Parque (skate, basquete +2 felicidade), ginásios/quadras, galerias de arte, academias (negócios de jogador com custo de entrada baixo). Campeonato mensal de futebol de botão: times de 6; 75% das inscrições → 50/35/15% para os 3 primeiros; 25% queimados. | 1 |
| **Pets e Pet Shop** | Gato ou cachorro. Atributos 0–5: alimentação (−1/h), água (−1/h de passeio, só bebe em casa), felicidade. Alimentação ou água 0 = **pet morre**. Felicidade 0 = avatar perde 50% de felicidade. Pet Shop: banho/tosa/hotel +30%; passeio +30% felicidade/saúde, −50% energia. Pet sitter recebe produtividade + 20%. | 1 |
| **Carros** | 3 raridades; corridas diárias (velocidade, força, experiência + sorte); vida útil média de 6 meses; atributos máximos até 3 meses e depois caem. Autoescola obrigatória (3 h parado). IPVA semestral; inadimplência suspende o uso. Limite diário de corridas (emissões). Motorista particular. Seguro e revisão reduzem panes. | 1 |
| **Agência de carros e barcos** | Loja do jogo; recompra pela depreciação; aluguel de 3 dias por 5% do valor. | 1 |
| **Oficina** | Reparos leve/moderado/grave = 1/3/7 dias. Negócio de jogador (ferramentas, óleo, máquinas). | 1 |
| **Posto de gasolina** | Bombas + refinadores, ambos com 30 usos. Petróleo vem da mineração. Crise de abastecimento possível. | 2 |
| **Barcos** | Corridas na fase 1 (habilitação "Marinha SSC"); carga e passageiros depois. Cor/velocidade/tamanho definem valor. | 1 |
| **Transportes de carga** | Caminhões N1/N2/N3, leite, combustível, cegonha; navios (hidrovia, pesqueiro, cargueiro, cruzeiro); trens (minério, carga mínima); aviões (30 usos, frete estatal na fase 2, privado na fase 3). | 2–3 |
| **Seguro** (Banco Smart Chain) | Cobre parcial/total: furacões, terremotos, tsunamis, roubos. | 1 |
| **Reparador** | Repara imóveis, trilhos, rodovias; reparar devolve saúde/felicidade. | 1 |
| **Lojas** | Roupas/acessórios (níveis 1–3 = +10/15/20%, sem depreciação, edições sazonais), calçados, móveis (casa completa = +1 felicidade), eletrodomésticos (fogão, geladeira, micro-ondas permitem cozinhar). Do jogo na fase 1; jogadores na fase 2. | 1/2 |
| **Telecomunicação** | Anúncios pagos; promoções aparecem num **dirigível** 3×/dia. Marketplace só é acessível com TV ou celular. | 1 |
| **Hotel** | 3 níveis; inclui alimentação; bônus por ocupação. | 1 |
| **Indústria** | Carros, barcos, motos, alimentos, carnes, aves, peixe, cimento, energia. Do sistema na fase 1, vendidas na fase 2, em quantidade limitada pelo tamanho da cidade. | 2 |
| **Mineração** | 20% dos lotes são mineráveis. Licença na Prefeitura + 3 dias de análise ambiental. Lendários: diamante, esmeralda, rubi, petróleo. Raros: ferro, magnésio, zinco. Comuns: madeira, papelão, couro, algodão, poliéster, cimento, brita, areia. | 2 |
| **Energia** | Plano semanal na usina (fase 1 do jogo). Solar: 1 painel/residência, 10/indústria, 1000 Wh/dia; −30% custos. Eólica −20%; hidráulica −20% (risco de enchente); atômica (risco radioativo); gás (canos). Gás de cozinha e industrial em botijões. | 1 (jogo) / 2–3 (jogadores) |
| **Empresas reais** | Marcas vendem produtos dentro do jogo. | 2 |

---

## 6. Fazenda

- Somente na **zona rural (região A3)**. Compra mínima: **1 slot (4 lotes)** + casa da fazenda, vendidos juntos pela Prefeitura.
- **Estações**: muda a cada 7 dias. Produção decrescente: verão > primavera > outono > inverno.
- **Níveis 1–3**: subir exige ≥ 3 colheitas + pagamento.
- **Arar**: precisa de enxada e de agricultor (próprio ou contratado); repetir após cada colheita.

| Nível | Frutas (energia) | Grãos/legumes (saúde) |
|------:|------------------|-----------------------|
| 1 | Uva, morango | Tomate, cenoura |
| 2 | + Laranja | + Beterraba, milho |
| 3 | + Maçã | + Trigo, batata |

**Riscos e proteções**

| Evento | Chance | Proteção |
|--------|-------:|----------|
| Colheita apodrece | 5% | — |
| Pássaros/doença (frutas) | 5% | Agrotóxico −20% da probabilidade |
| Corvos (grãos) | — | Espantalho −50% |
| Coelhos | 3% | Cão de pastoreio −50% de dano |
| Colheita não colhida | −5%/dia | Drone avisa quando está pronta |
| Febre aftosa (gado) | 3% → mata 25% | — |
| Raposas (galinheiro > 4 galinhas) | 3% → mata 50% | Cão de pastoreio |
| Gripe aviária | 3% → −25% ovos | — |

**Pecuária**
- Animais: galinhas (galinheiro, máx. 12, 1 galo/12 galinhas, limpeza a cada 5 dias por 30 THALER), porcos (chiqueiro 80 THALER, morrem em 3 dias sem comida), gado de corte e leite (pasto + curral + comedouro, 15 filhotes máx., intervalo de 3 dias, vida útil 45 dias).
- Adulto após ser alimentado ≥ 3 vezes; abate antes disso não dá item.
- Reprodução com trigo ou milho. Níveis do animal 1–3: +0/+10/+20% de itens.
- Chocadeira: 3% de chance de **galinha dos ovos de ouro** (2× eficiência).
- **Maquinário** essencial: comedouro, galpão, geladeira industrial, enxada. Aceleradores: irrigador, drone, separador de sementes (+20% germinação).

---

## 7. Alimentos (Tabela de Atributos)

| Alimento | Energia | Saúde | Pacote |
|----------|--------:|------:|-------:|
| Milho | +1 | +1 | 5× |
| Tomate | +1 | +2 / +3 **⚠** | 5× |
| Beterraba | +1 | +2 | 5× |
| Cenoura | +1 | +3 | 5× |
| Trigo (pão) | +2 | +2 | 5× |
| Batata | +2 | +2 | 5× |
| Maçã | +3 | +1 | 5× |
| Laranja | +2 | +1 | 5× |
| Uva / Morango | +1 | +1 | 5× |
| Carne (vaca/porco/frango) crua | +1 | −1 | 3× |
| Carne cozida | +3 | 0 | 3× |
| Ovos / Leite | +1 | 0 | 3× |
| Algodão-doce / Pipoca / Milk-shake | +1 | −1 | 1× |

Pets recebem 50% do efeito do alimento; animais de fazenda, 50% da energia.

---

## 8. Eventos semanais por profissão

Toda semana um grupo de profissões recebe bônus, para equilibrar o valor das raridades.

| Grupo | Profissões | Exemplos de evento |
|-------|-----------|--------------------|
| Comida | Padeiro, agricultor, confeiteiro, pescador, recepcionista, garçom, cozinheiro, fazendeiro, chef, agrônomo | Evento gastronômico (com marcas reais), Agroweek, feira orgânica, fim do defeso |
| Saúde | Enfermeiro, bombeiro, farmacêutico, dentista, médico, veterinário | Congresso, Olimpíadas, Copa do Mundo, Semana da Saúde, Dia do Médico |
| Lazer | Alfaiate, professor, modelista, orientador, arquiteto, designer, hoteleiro, concierge, estilista, astronauta | Fashion week, voos para outro planeta, competição de arte, leilão, feira literária |

Acrescentar: eventos sazonais (Natal, Carnaval, Festa Junina) com itens exclusivos — principal lição do RiseCity.

---

## 9. Fases de conteúdo (do GDD)

| Fase | O jogo controla | Jogadores controlam |
|------|-----------------|---------------------|
| **1** | Mercados, fast food, lojas, indústrias, energia, transporte público, agências | Avatares, lotes, imóveis, fazendas, academias, galerias, oficinas, farmácias, pet shops, hotéis |
| **2** | Energia (parcial), frete aéreo estatal | Franquias, lojas, indústrias, food trucks, postos, mineração |
| **3** | Governança | Transportadoras aéreas, concessão do transporte público, usinas |
