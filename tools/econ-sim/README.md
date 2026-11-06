# tools/econ-sim

Simulador econômico por agentes (E0.5). Critério de aprovação ([ADR-0010](../../docs/adr/0010-criterio-economia-cobertura.md)): payback entre 40 e 78 dias, cobertura em dólar (entradas ÷ saques) ≥ 1 e pool P2E sem esgotar. Ver [trilha-ferramentas.md §A](../../docs/desenvolvimento/trilha-ferramentas.md#a-simulador-econômico--toolsecon-sim) e [doc 04](../../docs/04-economia-tokenomics.md).

Node 20+, sem dependências.

```bash
npm test                # fórmulas, ledger, determinismo e desempenho
npm start -- --scenario p100 --growth base
npm run gate            # 3 × 3 cenários; sai com erro se reprovar
npm run sweep           # varre a escala dos custos fixos (com o dreno da base)
npm start -- --sweep-income    # varre um dreno proporcional à renda
npm start -- --all --no-brake                       # testa uma hipótese
npm start -- --sweep-land --elasticity 1             # varre o preço por m² dos lotes
```

Relatórios (CSV, HTML, JSON) saem em `out/`. Cada linha traz payback por raridade, sinks/faucets, THALER per capita, SCITY pago, dia em que o pool P2E esgota e dólares que entraram e saíram.

## Como funciona

- **Parâmetros:** [params/base.json](params/base.json). Cada bloco diz sua `fonte`: **doc** (especificado) ou **premissa** (o doc 11 §2 manda definir aqui). Toda premissa é ponto de partida, não decisão de produto.
- **Agentes:** raridade, perfil (casual, estratégico, investidor), moradia própria ou aluguel. 100 mil agentes em 365 dias rodam em ~6 s.
- **Ledger:** todo THALER vem de um faucet ou de outra conta e vai para um sink, outra conta ou a conversão. O erro precisa fechar em zero, e o simulador aborta se não fechar.
- **Payback:** dias até `saques + saldo líquido do spread` cobrir o combo, mediana por raridade da coorte inicial que não saiu do jogo. Quem sai do jogo não entra na mediana, então o número é otimista.
- **Cobertura em dólar:** combos, lotes e casas pagos com dinheiro novo ÷ dólares sacados no período.
- **Razão sinks/faucets:** indicador, sem meta. Conta só o que é destruído (doc 04 §7). A conversão em SCITY não conta, apenas a taxa dela; a coluna "dreno c/ saques" mostra a versão que conta.

**Venda primária de lotes e casas** (`land` nos parâmetros; `--no-land` desliga): ninguém nasce dono. Cada jogador sem imóvel tenta comprar com chance diária por perfil, em faixas sucessivas de lote: A1 (2.916 lotes, 950 SCITY), A2 (11.664, 400) e expansão (11.664, 260), mais uma casa de 4.000 THALER. Parte das compras usa dinheiro novo (entra em dólar), parte usa o saldo em THALER (é sink). O preço é fixo em dólar (`priceInUsd`; com `false`, fixo em SCITY). No payback, o imóvel conta por 80% do que custou.

**Freio do pool** (`poolBrake`; `--no-brake` desliga): quando o SCITY pago se aproxima do liberado, o limite de saque cai e o spread sobe, gradualmente.

**Fora do modelo:** marketplace, corridas, fazenda, staking e revenda de lotes. O preço do SCITY é dado pelo cenário e não reage à venda dos jogadores, o que **esconde** a queda que a pressão de venda causaria. A entrada de dinheiro novo é a premissa mais sensível: `freshMoneyShare` não tem base em dados.

## Preço dos lotes (05/11/2026)

Os lotes reais de Pittsburg (mapa, E1.8) custavam ~3.500 SCITY no preço por m² do doc 13, enquanto a economia tinha sido aprovada com lotes de 260–950 SCITY. Agora o simulador vende o estoque real: os 24.717 lotes vazios, em faixas de área exportadas por `scripts/lotes-para-params.mjs` para `params/lotes-pittsburg.json`, só contagens. A demanda reage ao preço: `elasticity` 1 significa que lote 2× mais caro vende metade.

Varredura do preço por m² (`priceScale` × doc 13), 9 cenários:

| Escala | Lote mediano | Sem elasticidade | Elasticidade 1 | Lotes vendidos no ano (base, elast. 1) |
|---:|---:|---:|---:|---:|
| 0,1 | 520 SCITY | 6/9 | 1/9 | 7.363 |
| 0,2 | 1.040 | 9/9 | 6/9 | 4.745 |
| **0,3** | **1.560** | 9/9 | **9/9** | **3.305** |
| 0,5 | 2.600 | 9/9 | 9/9 | 2.248 |
| 1 (doc 13) | 5.200 | 9/9 | 9/9 | 1.234 |

1. **O preço do doc 13 não reprova a economia; ele trava a cidade.** Lote caro passa no gate, mas com demanda sensível ao preço só ~5% do estoque vende no ano, e o jogo de construir fica sem lotes ocupados.
2. **Sem elasticidade o modelo mente:** com demanda fixa, cada aumento de preço só aumenta a cobertura. Com elasticidade 1, a receita de lotes fica em US$ 5,2–5,6 M por ano em qualquer escala, então subir preço não salva a economia.
3. **Adotado: escala 0,3**, ou US$ 0,78/m² residencial (lote mediano de US$ 1.560 fixos), US$ 1,56/m² uso misto e US$ 2,85/m² comercial. Aprova 9 de 9 nas 4 sementes testadas e vende ~3.300 lotes no ano.
4. **A folga é fina.** Com metade do dinheiro novo previsto, ou com elasticidade 1,5, cai para 1 de 9 (cobertura ~0,89). Elasticidade e dinheiro novo são premissas sem dados: calibrá-las é o que decide se a aprovação é real.
5. **O tamanho do lote vazio é escolha do gerador**, não dado: a mediana de 2.000 m² vem do raio de 15 m mais a margem de 12 m do `city-import`. Lote menor com o mesmo preço por m² é lote mais barato.

## Resultado (31/10/2026): aprovado no gate, 9 de 9

Critério do [ADR-0010](../../docs/adr/0010-criterio-economia-cobertura.md). `npm run gate` passa, e o resultado se repete em 3 outras sementes. **Isso aprova o modelo com as premissas atuais, não prova que a economia real fecha:** a cobertura ainda depende de premissas sem dados (ver ressalvas).

Regras adotadas em `params/base.json`:

| Regra | Valor |
|---|---|
| Dreno proporcional à renda (`sinks.incomeRate`) | 55% |
| Preço do lote | Fixo em dólar: não barateia quando o SCITY cai |
| Freio do pool (`poolBrake`) | A partir de 70% do liberado já usado, o limite de saque cai até zero e o spread sobe até +10 pontos, de forma gradual |

| Preço do SCITY | Crescimento | Payback C/R/E/L | Cobertura | SCITY pago | Freio |
|---:|---|---:|---:|---:|---:|
| US$ 1,00 | baixo | 70 / 51 / 52 / 42 | 1,23 | 5 M | — |
| US$ 1,00 | base | 67 / 54 / 60 / 42 | 1,08 | 13 M | — |
| US$ 1,00 | alto | 69 / 54 / 51 / 43 | 1,02 | 32 M | — |
| US$ 0,50 | baixo | 70 / 51 / 52 / 42 | 1,23 | 10 M | — |
| US$ 0,50 | base | 67 / 54 / 60 / 42 | 1,08 | 27 M | — |
| US$ 0,50 | alto | 69 / 54 / 51 / 43 | 1,02 | 64 M | — |
| US$ 0,20 | baixo | 70 / 51 / 52 / 42 | 1,23 | 26 M | — |
| US$ 0,20 | base | 67 / 54 / 60 / 42 | 1,08 | 67 M | — |
| US$ 0,20 | alto | 67 / 55 / 47 / 45 | 1,44 | 114 M | 288 dias, pico de 76% |

A razão sinks/faucets, só indicador, fica em 0,70.

**Ressalvas:**

1. **O freio segura dinheiro do jogador.** No último cenário ele fica ligado 288 dias, corta o limite de saque em até 76% e leva o spread a ~15%. O saldo médio fica em ~4.100 THALER, contra ~1.100 nos demais. O payback conta esse saldo como se fosse sacável, então ali ele é otimista: é o cenário mais frágil, e a cobertura de 1,44 reflete saque contido, não saúde.
2. **A aprovação depende de crescimento.** Com 20 mil jogadores e nenhum novo entrante, a cobertura é 0,90 em 1 ano e 0,70 em 2 anos, porque lote é venda única. Esse caso também não repõe quem sai e não faz parte do gate.
3. **A folga é pequena.** Com `freshMoneyShare` pela metade a cobertura vira 0,99 e reprova, e essa premissa não tem dados. A US$ 1 com crescimento alto a cobertura é 1,02.
4. **O preço do SCITY não reage à venda dos jogadores.** A pressão de venda aparece só como SCITY pago, até 114 M no ano. Sem liquidez para absorver isso, o preço cairia, e o modelo não mostra esse efeito.
5. **O dreno de 55% é uma taxa-alvo, não uma mecânica pronta.** O jogo precisa alcançá-lo com consumo, manutenção e impostos proporcionais à renda, e ninguém testou como o jogador recebe isso.

**Testes que levaram às regras** (`p100/base`, salvo indicação):

| Teste | Payback C/R/E/L | Sinks/faucets | US$ entrou → saiu |
|---|---:|---:|---:|
| Só custos fixos | 21 / 19 / 19 / 18 | 0,20 | 14,2 M → 27,5 M |
| Custos fixos × 5 | 111 / 46 / 37 / 27 | 0,60 | 14,4 M → 16,6 M |
| Dreno de 70% | 143 / 102 / 90 / 86 | 0,84 | 14,5 M → 7,5 M |
| Dreno de 80% | nunca / 218 / 166 / 136 | 0,92 | 14,5 M → 3,8 M |
| Exp. × Pet 2,2 e dreno de 83% | 99 / 73 / 64 / 59 | 0,90 | 14,4 M → 10,4 M |

Custo fixo quebra os comuns antes de drenar o suficiente, por isso o dreno é proporcional. Uma razão de 0,9 leva o payback a mais de 150 dias, e Exp. × Pet mostra que ela pode subir sem mudar o que sai do jogo, por isso virou indicador. Com lote em SCITY, o mesmo dreno aprova só 3 de 9, porque a queda do token barateia o lote em dólar.

**Próximos passos:** calibrar `freshMoneyShare` e a rotatividade com dados de venda, incluir um cenário sem crescimento no gate e modelar o preço do SCITY reagindo à venda.
