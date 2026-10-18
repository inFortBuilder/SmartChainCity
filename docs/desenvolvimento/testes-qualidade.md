# Testes e Qualidade

## Pirâmide por trilha

| Trilha | Unitário | Integração | Ponta a ponta / outros |
|--------|----------|------------|------------------------|
| services | Vitest/Jest nas regras de `domain/` (≥ 90% em economia e ledger) | Testcontainers (Postgres + Redis) por serviço | Fluxo login → turno → coleta contra a API |
| contracts | `forge test` | Testes com *fork* da BSC Testnet | Fuzz e invariantes (`forge test --fuzz-runs 10000`), Slither |
| client-unity | Unity Test Framework (EditMode) | PlayMode com servidor *mock* | Smoke test do build WebGL em navegador sem interface (Playwright) |
| cms | Testes do esquema e dos webhooks | — | — |
| tools/econ-sim | Testes das fórmulas | — | Relatório de cenários anexado ao PR |

## Testes obrigatórios de economia
- **Invariante do ledger:** em cada transação a soma das entradas por moeda é 0; nenhum saldo de jogador fica negativo.
- **Idempotência:** repetir a mesma requisição de coleta ou saque não credita duas vezes.
- **Concorrência:** 100 coletas simultâneas do mesmo turno resultam em 1 crédito.
- **Sorteios:** distribuição empírica dos danos e das Lucky Boxes dentro de ±1% das probabilidades publicadas em 1 milhão de amostras.

## Definition of Done (toda issue)
- [ ] Critérios de aceite da issue atendidos.
- [ ] Testes escritos e passando no CI.
- [ ] Sem regras de jogo fixas no código (vêm do catálogo).
- [ ] Logs e métricas para o fluxo novo.
- [ ] Documentação em `docs/` atualizada se a regra mudou.
- [ ] Revisado e aprovado; para contratos, revisão de 2 pessoas.

## Orçamentos verificados no CI
- Tamanho do build WebGL (falha se o download inicial passar de 25 MB).
- Tempo de resposta p95 da API em teste de carga noturno (< 200 ms nas rotas de leitura).
- Gás das funções principais dos contratos (`forge snapshot`, falha se subir > 10% sem justificativa).
