## O que muda
<!-- Resumo e motivação. Closes #<issue> -->

## Como testar
<!-- Passos, comandos, cenas Unity, endpoints -->

## Checklist
- [ ] Testes adicionados ou atualizados e passando
- [ ] Sem segredos no diff
- [ ] Nenhuma regra de saldo, ganho ou sorteio no cliente
- [ ] Docs em `docs/` atualizadas (se a regra mudou)

## Impactos
- [ ] **Economia** — relatório do `tools/econ-sim` anexado
- [ ] **Contratos** — testes de fuzz/invariantes, `forge snapshot`, 2 aprovações
- [ ] **API** — `openapi.yaml` atualizado e cliente regenerado
- [ ] **Build WebGL** — tamanho do download inicial conferido (≤ 25 MB)
