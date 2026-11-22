# Indexer, RPC ou reorganização (SEV2; SEV1 se creditou errado)

O chain-indexer lê os eventos confirmados (`CONFIRMATIONS`) e credita o depósito uma vez, pela transação e pelo log. Também avisa o game-core e o world das transferências de NFT.

**Sinais:**
- depósito confirmado na cadeia que não aparece no jogo;
- `ServicoFora` do chain-indexer;
- RPC respondendo erro ou atrasado;
- o cursor do indexer parado.

## Depósito não credita (SEV2)

1. Conferir o RPC: `cast block-number --rpc-url $BSC_RPC` responde e avança? Se não, trocar para o RPC reserva (configuração do indexer) e reiniciar.
2. O indexer retoma do cursor salvo: os depósitos atrasados creditam sozinhos, e a idempotência por transação e log impede crédito duplo.
3. Avisar só se passar de 1 h ([modelo SEV2](../comunicacao.md#2-atraso-sem-perda)).

## Reorganização ou crédito errado (SEV1)

Com `CONFIRMATIONS` adequado (≥ 15 na BSC), uma reorganização não chega a creditar. Se creditou mesmo assim:

1. [Trava `withdrawals` e `exchange`](travas-do-economy.md): o SCITY creditado sem lastro não pode sair.
2. Listar os créditos cuja transação não existe mais na cadeia canônica.
3. Estornar pelo ledger com a chave `incident-reversal:<incidente>:<tx>`. Se o jogador já gastou dentro do jogo, o saldo fica negativo para revisão, e o caso é tratado um a um.
4. Subir `CONFIRMATIONS` e fazer o pós-incidente.

## NFT trocou de dono na cadeia e não no jogo

O job `chain.sync` do game-core e o do world refazem pelo cursor. Se travou, reiniciar o serviço. A posse no jogo segue a cadeia (o que vale é o `Transfer` confirmado).
