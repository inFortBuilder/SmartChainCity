# Fazenda de bots, saque em massa, pool P2E drenando (SEV1 ou SEV2)

**Sinais:**
- alertas `PoolP2EAcabando` e `PoolP2ECritico`;
- `DrenoAbaixoDaMeta`;
- muitos saques de contas novas;
- o antifraude do game-core marcando contas em revisão (mesmo aparelho, mesma rede, velocidade).

## 1. Estancar

- **Saída de SCITY em ritmo anormal:** [trava `withdrawals`](travas-do-economy.md) (SEV1). Os saques legítimos esperam, mas o cofre não esvazia.
- **Conversão THALER → SCITY puxando o pool:** [trava `exchange`](travas-do-economy.md). O freio do pool já reduz sozinho, e a trava para de vez.
- O jogo continua: os bots seguem trabalhando, mas o THALER não sai.

## 2. Separar quem é bot

1. Contas em revisão no antifraude ([game-core](../../../services/game-core/README.md#antifraude-e29-passo-15-da-trilha)), mais as do mesmo aparelho, rede ou carteira de destino.
2. Conferir o padrão: horários, turnos idênticos e a carteira que recebe os saques.
3. Bloquear as contas confirmadas pelo antifraude. Estornar o ganho indevido pelo ledger, com registro do motivo.

## 3. Voltar

- Desligar as travas.
- Se o pool caiu demais, revisar a emissão com o simulador (`tools/econ-sim`) antes de reabrir o câmbio.
- Ajustar os limites (KYC no saque, teto do cofre pelo timelock) se o ataque passou por eles.
- Pós-incidente, com os números do painel econômico.
