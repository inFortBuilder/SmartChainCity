# Travas do economy (saque e câmbio)

Interruptores da operação que param o dinheiro que sai do jogo, **sem deploy e sem multisig**, com efeito no próximo pedido ([switches.ts](../../../services/economy/src/domain/switches.ts)).

| Trava | Para | Não para |
|---|---|---|
| `withdrawals` | Novos pedidos de saque (emissão de voucher do GameVault) | Vouchers já emitidos (esses param com a [pausa do cofre](pausar-contratos.md)); depósitos |
| `exchange` | Câmbio THALER ↔ SCITY nos dois sentidos | Turnos, compras com THALER, mercado on-chain |

A trava fica no banco do economy, então vale para todas as instâncias e sobrevive a reinício. O jogador vê o aviso no mapa com o **motivo público**, e a resposta da API é `503 withdrawals_frozen` ou `exchange_frozen`, com "Seu saldo está seguro". O alerta `TravaDeIncidenteLigada` dispara em 1 min, e `TravaLigadaHaMaisDe24h` lembra que ela não pode ser esquecida ligada.

## Ligar

```bash
curl -X PUT "$ECONOMY/internal/v1/economy/switches/withdrawals" \
  -H "x-service-token: $ECONOMY_INTERNAL_TOKEN" -H 'content-type: application/json' \
  -d '{"frozen": true, "reason": "verificação de segurança", "by": "<seu nome>"}'
```

- `reason` é **público**: curto, sem detalhe do incidente.
- `by` fica no log, com o horário, para a linha do tempo.
- O token é o `INTERNAL_TOKEN` do economy, que fica no cofre de segredos e nunca no chat do incidente.

## Conferir

```bash
curl "$ECONOMY/v1/economy/status"
# {"switches":{"withdrawals":{"frozen":true,"reason":"verificação de segurança","since":"…"},"exchange":{…}}}
```

## Desligar

Mesmo comando, com `"frozen": false`. O motivo some. Desligar só com a decisão do comandante, depois que a causa estiver resolvida.
