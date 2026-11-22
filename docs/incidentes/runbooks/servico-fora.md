# Serviço ou banco fora do ar (SEV2)

**Sinais:**
- alertas `ServicoFora`, `Erros5xx` e `LatenciaP95Alta` ([alertas](../../../infra/observability/alertas.yml));
- o painel do Grafana por serviço.

## Passos

1. **Qual serviço?** O `/healthz` de cada um e os logs JSON, filtrados pelo `requestId` de um erro.
2. **Banco:** conexões, disco e réplica. Se o primário caiu, a troca para a réplica segue o procedimento do provedor (Multi-AZ). Nenhuma escrita manual no ledger.
3. **Reiniciar** o serviço. Os jobs são idempotentes e retomam sozinhos:
   - `purchases.settle`, `properties.settle`, `withdrawals.settle`, `shift`, `race`, `championship.settle`;
   - cobranças com chave: repetir nunca cobra duas vezes.
4. **Deploy recente?** Voltar a versão anterior antes de investigar.
5. **Realtime (multiplayer):**
   - o jogo segue sem ele: chat e presença somem, e o resto funciona;
   - com shards por bairro, cair um processo afeta só os bairros dele (`SHARD=i/n`).
6. Avisar se passar de 30 min ([modelo SEV2](../comunicacao.md#2-atraso-sem-perda)).

## Dependências externas

| Fora | Efeito | O que fazer |
|---|---|---|
| RPC da BSC | Depósitos atrasam, a leitura do cofre falha | RPC reserva ([indexer-rpc.md](indexer-rpc.md)) |
| Strapi | Nenhum: o jogo usa o último catálogo válido ou o seed | Reiniciar quando der |
| KMS | Não emite voucher | [Trava `withdrawals`](travas-do-economy.md) até voltar, com o motivo "manutenção" |
| Chainlink VRF | Caixas abertas esperam o sorteio | Pausar a `LuckyBox` se demorar; o pedido pago é cumprido quando o VRF responde |
