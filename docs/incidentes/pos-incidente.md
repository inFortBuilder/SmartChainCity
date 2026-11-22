# Pós-incidente: modelo

Em até 5 dias úteis depois do encerramento, sem procurar culpados: o objetivo é o sistema, não a pessoa. Copie para `docs/incidentes/registros/AAAA-MM-DD-<titulo>.md`. Se houver dado sensível, o registro fica fora do repositório público.

```markdown
# <Título curto> — <data>

- Severidade: SEV<1|2|3>
- Comandante: <papel, sem dado pessoal>
- Duração: <início> → <estancado> → <encerrado> (BRT)

## Resumo
<3 linhas: o que houve, impacto, como acabou>

## Linha do tempo
| Hora (BRT) | O quê |
|---|---|
| | |

## Impacto
<contas, valores, período, serviços>

## Causa
<técnica e, se houver, de processo>

## O que funcionou
- 

## O que faltou ou atrasou
- 

## Ações
| Ação | Dono | Prazo | Onde (PR, ROADMAP) |
|---|---|---|---|
| | | | |

## Ressarcimento
<critério, total, lançamentos `incident_refund` e status>
```

Métricas para acompanhar entre incidentes:
- tempo até estancar (meta < 15 min no SEV1);
- tempo até o primeiro aviso (meta < 1 h);
- ações do pós-incidente fechadas no prazo.
