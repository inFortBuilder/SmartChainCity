# ADR-0010 — Critério da economia: payback e cobertura em dólar

- **Status:** Aceito
- **Data:** 2026-10-31
- **Trilhas afetadas:** econ · backend · contracts

## Contexto
O critério da Etapa 0 pedia payback de 40–78 dias e sinks/faucets ≥ 0,9. O simulador (`tools/econ-sim`) mostrou que as duas metas disputam a mesma margem: com razão de 0,9 o payback passa de 150 dias. Mostrou também que a razão é maquiável: aumentar o ganho e o dreno juntos a eleva sem mudar quanto dinheiro sai do jogo.

## Opções consideradas
1. Manter payback 40–78 dias e sinks/faucets ≥ 0,9, revendo os ganhos.
2. Manter o payback e trocar a razão por cobertura em dólar: dólares que entram ÷ dólares sacados ≥ 1.

## Decisão
Opção 2. O jogo aprova com payback de 40–78 dias, cobertura em dólar ≥ 1 e pool P2E sem esgotar. Sinks/faucets continua como indicador de painel, sem meta de aprovação.

## Consequências
A aprovação depende de premissas de receita (dinheiro novo, preço dos lotes) que precisam de dados reais. A cobertura mede um período: precisa ser acompanhada também com a cidade sem crescer, porque lote é venda única. Os gatilhos que usavam a razão ≥ 0,9, como a expansão em Live Ops, passam a usar a cobertura.
