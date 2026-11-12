# ADR-0013 — Regras de jogo para os conflitos entre as fontes

- **Status:** Aceito (2026-11-12)
- **Data:** 2026-11-12
- **Trilhas afetadas:** backend · cms · econ · client

## Contexto
O GDD, o tokenomics, a planilha e o Strapi antigo dizem coisas diferentes sobre as mesmas regras ([doc 11 §1](../11-decisoes-pendentes.md#1-conflitos-nas-fontes)). Sem uma fonte única, o backend e o simulador não têm o que implementar.

## Opções consideradas
1. Escolher caso a caso, quando cada sistema for implementado. Atrasa e espalha a decisão.
2. Fixar agora as recomendações do doc 11 numa ADR única.

## Decisão
Opção 2. Valem estas regras:

| # | Tema | Regra |
|---|------|-------|
| 1 | Educação | Escala de 0 a 100, cumulativa (casa com os multiplicadores 1×/2×/3× da tabela de atributos) |
| 2 | Play-to-Earn | 41% do suprimento (a soma do tokenomics fecha 100%) |
| 3 | Multiplicadores | Experiência × Pet com teto conjunto de 2,5×, a validar no simulador |
| 5 | Avatares | No máximo 3 por conta verificada |
| 6 | Avatar por usuário | Relação 1:N |
| 7 | Raridade de lote | Preço por região; raridade só para lotes especiais (orla, esquina, mineração) |
| 8 | Fast food | Cada nível aplica +energia e −saúde; +1 de felicidade fixo |
| 9 | Fazenda | Fica no anel 2 (doc 03 §2) |

O item 4 (tomate duplicado na tabela de alimentos) fica pendente: um dos dois é provavelmente outro alimento, e só a fonte original confirma.

## Consequências
- O catálogo do Strapi e o Game Core seguem esta tabela; o Strapi antigo (máx. 10 de educação, 1 avatar por usuário) precisa de migração.
- O teto de 2,5× entra como parâmetro do simulador antes de virar regra no servidor.
