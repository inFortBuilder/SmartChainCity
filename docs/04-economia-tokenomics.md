# 04 — Economia e Tokenomics

## 1. Modelo de duas moedas

Inspirado em FarmPoly (Poly/Libra) e MouseHaunt ($MHT/$MCHEESE), e já presente no Strapi (`wallet.scity`, `wallet.thaler`, `conversion-factor`).

| | **SCITY** | **THALER** |
|---|-----------|------------|
| Natureza | Token on-chain BEP-20 (BNB Smart Chain) | Moeda interna, ledger no servidor |
| Oferta | Fixa ≈ **1.000.000.000** | Ilimitada, emitida por gameplay |
| Usos | Comprar Lucky Box, lotes, imóveis raros, marketplace, staking, governança futura | Comida, aluguel, impostos, combustível, reparos, serviços entre jogadores |
| Entrada | Compra em DEX / ICO | Ganhos de trabalho, negócios, aluguel; depósito de SCITY |
| Saída | Saque para a carteira | Conversão para SCITY (com taxa e limites) |

Separar as moedas protege o token on-chain da inflação do dia a dia e permite ajustar a economia sem tocar no contrato.

---

## 2. Distribuição do SCITY (Tokenomics FGV Jr.)

| Destino | % | Tokens (1 bi) | Liberação proposta (vesting) |
|---------|--:|--------------:|------------------------------|
| **Play-to-Earn** | 41,0% | 410.000.000 | Pool de recompensas, liberação anual (ver §3) |
| **Staking** | 20,0% | 200.000.000 | Emissão por bloco/epoch ao longo de 5 anos |
| **DEV** | 9,5% | 95.000.000 | Cliff 12 meses + 24 meses linear |
| **Team** | 9,5% | 95.000.000 | Cliff 12 meses + 24 meses linear |
| **Marketing** | 7,0% | 70.000.000 | 10% no TGE + 36 meses linear |
| **Liquidez** | 6,0% | 60.000.000 | 50% no TGE (pool DEX, LP travado ≥ 12 meses) + reserva |
| **ICO** | 3,5% | 35.000.000 | 25% no TGE + 6 meses linear |
| **Advisors** | 1,0% | 10.000.000 | Cliff 6 meses + 18 meses linear |
| **Ação Social** | 1,0% | 10.000.000 | Multisig dedicada, uso público e reportado |
| **AirDrop** | 1,0% | 10.000.000 | Campanhas; recebido pode exigir atividade no jogo |
| **STAFF** | 0,5% | 5.000.000 | Cliff 6 meses + 12 meses linear |
| **Total** | **100%** | **1.000.000.000** | |

Notas:
- O estudo **não recomenda pré-venda de tokens**; a pré-venda deve ser de **boxes e lotes**.
- Os prazos de vesting acima são uma **proposta desta documentação** (o estudo não define); o cliff de ≥ 12 meses para equipe segue a lição do Bombcrypto.
- A planilha usa **42%** para P2E e o tokenomics **41%** — ver doc 11.

## 3. Liberação do pool P2E por ano

| Ano | % do pool | Tokens |
|----:|----------:|-------:|
| 1 | 30% | 123.000.000 |
| 2 | 25% | 102.500.000 |
| 3 | 20% | 82.000.000 |
| 4 | 15% | 61.500.000 |
| 5 | 10% | 41.000.000 |

Se a comunidade crescer acima da projeção (base: 40 mil jogadores = 40% da capacidade de 100 mil), as liberações podem ser **semestrais**, com tudo em circulação em ~2,5 anos.

---

## 4. Fórmula de ganho diário

```
ganho_THALER = base(raridade, profissão)
             × M_saude(nível) × M_felicidade(nível) × M_experiencia(nível)
             × M_pet(nível) × M_itens (roupas 1,10/1,15/1,20; ferramentas temporárias)
             × fator_regularizacao_moradia (1,0 ou 0,5)
             × fator_evento_semanal
             − danos_do_turno
```

- Os multiplicadores estão em [02 — GDD §2.4](02-game-design.md#24-multiplicadores-tabela-de-atributos).
- A planilha assume que **(Experiência + Pet)** é anulado por **(queima + decaimento natural dos múltiplos)**; logo o payback é calculado só com Felicidade e Saúde ("Múltiplos F e S").
- Danos do turno são sorteados no servidor com seed auditável (doc 05).

## 5. Câmbio THALER ↔ SCITY ("banco central")

Da planilha:

| Cenário | Preço SCITY | Conversor (THALER por SCITY) |
|---------|------------:|-----------------------------:|
| Base | US$ 1,00 | 20 |
| | US$ 0,50 | 10 |
| | US$ 0,20 | (recalcular) |

O conversor **flutua** para manter o payback em dólares estável. Regras propostas:
- Atualização diária pelo preço médio (TWAP 24 h) da DEX.
- **Spread de saída**: converter THALER → SCITY usa taxa pior que SCITY → THALER (lição FarmPoly); proposto 5–10%.
- **Limite diário de saque** por conta e **carência** de 7 dias para contas novas.
- A taxa de saída é queimada ou volta ao pool P2E.

## 6. Payback-alvo

Preço do combo (avatar + itens iniciais): Comum US$ 150 · Raro 200 · Épico 250 · Lendário 300.

| Projeção (planilha) | Múltiplos | Ganho | Payback |
|---------------------|----------:|-------|--------:|
| Otimista | 100% | máximo | ~40 dias |
| Realista-otimista | 100% | médio | ~42–43 dias |
| Realista-conservadora | 75% | médio | ~65–68 dias |
| Conservadora | 75% | mínimo | ~69–78 dias |

- O payback considera lote e imóvel medianos; jogadores sem imóvel ganham bem menos (gastam com aluguel e comida).
- Margem de risco: 50% sobre o patrimônio dos jogadores (≈ 1,5 payback).
- Dimensionamento: 100 mil avatares (40k comuns, 30k raros, 20k épicos, 10k lendários) → P2E parcial ≈ 280 M SCITY; com margem ≈ 420 M → supply ≈ 1 bi com 42% para P2E.

> **Alerta de sustentabilidade:** com esses números, o P2E consome em poucos meses o volume que o cronograma libera por ano. A economia **só fecha** se a maior parte dos ganhos ficar em THALER, circular entre jogadores e for drenada pelos sinks — e se a conversão para SCITY tiver limites. O simulador econômico (doc 09, fase 0) deve provar isso antes do lançamento.

---

## 7. Faucets e sinks

| Faucets (emitem) | Sinks (drenam) |
|------------------|----------------|
| Turnos de trabalho | Comida, hospital, farmácia |
| Renda de imóveis e aluguel | IPTU semestral, PT de lote vazio |
| Negócios (vendas a NPCs) | Água, energia (plano semanal), gás |
| Corridas e campeonatos | Combustível, IPVA, autoescola, habilitação |
| Staking (SCITY) | Reparos (oficina, reparador), depreciação de veículos e máquinas |
| Eventos e airdrops | Seguros |
| | Escola, troca de profissão |
| | Desastres naturais, assaltos, doenças de animais |
| | Taxas de marketplace e de conversão |
| | 25% das inscrições de campeonatos |
| | Anúncios (dirigível) |
| | Licenças de mineração, upgrades de imóvel/fazenda |
| | Lucky Boxes, venda primária de lotes, GamePass/VIP |

**Painel de saúde econômica** (obrigatório antes do lançamento):
- THALER emitido vs. drenado por dia; razão alvo ≥ 0,9.
- Estoque de THALER per capita; velocidade de circulação.
- Conversões THALER → SCITY por dia vs. compras de SCITY.
- Payback efetivo por coorte de raridade.
- Preço do SCITY, profundidade do pool de liquidez.

## 8. Mecanismos adicionais recomendados

- **GamePass / VIP sazonal** (Mafagafo, RiseCity): níveis 1–5 com redução de risco de desastre e itens exclusivos; pago em SCITY.
- **Staking com recompensa in-game** (Mobox): parte da recompensa como boosts e itens, reduzindo a emissão em SCITY.
- **Itens sazonais** que valorizam como colecionáveis.
- **Período de teste grátis**: avatar de aluguel (*scholarship*) com ganhos limitados e não conversíveis, para reduzir a barreira de entrada.
