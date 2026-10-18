# Como contribuir

1. Configure o ambiente: [docs/desenvolvimento/setup-ambiente.md](docs/desenvolvimento/setup-ambiente.md).
2. Pegue uma issue do milestone atual (ou abra uma usando os modelos em `.github/ISSUE_TEMPLATE`).
3. Crie a branch `feat/<trilha>-<issue>-<resumo>` a partir da `main`.
4. Siga os [padrões de código](docs/desenvolvimento/padroes-codigo.md) e a [Definition of Done](docs/desenvolvimento/testes-qualidade.md#definition-of-done-toda-issue).
5. Faça commits no formato [Conventional Commits](docs/desenvolvimento/fluxo-git.md#commits--conventional-commits).
6. Abra o PR com o modelo preenchido e vincule a issue.

Regras que não se negociam:
- Nenhum segredo (chave privada, `.pem`, senha, token) no repositório.
- Nenhuma regra de saldo, ganho ou sorteio no cliente.
- Mudanças de balanceamento vêm com o relatório do `tools/econ-sim`.
- Mudanças em `contracts/` precisam de 2 aprovações.
