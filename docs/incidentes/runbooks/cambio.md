# Câmbio manipulado (SEV1)

O câmbio THALER ↔ SCITY usa o TWAP de 24 h do pool da DEX, com spread, teto diário e freio do pool. Um ataque tenta mover o preço do pool para converter barato ou caro.

**Sinais:**
- cotação (`GET /v1/economy/fx`) mudando muito entre períodos;
- volume grande no pool em poucos blocos;
- conversões concentradas em poucas contas logo depois.

## Passos

1. [Trava `exchange`](travas-do-economy.md).
2. Comparar o TWAP com o preço de outras fontes (agregador, outras DEX). Se o TWAP foi puxado, fixar a cotação pela rota da operação até o pool normalizar:
   ```bash
   curl -X POST "$ECONOMY/internal/v1/economy/fx" -H "x-service-token: $ECONOMY_INTERNAL_TOKEN" \
     -H 'content-type: application/json' -d '{"scity_usd": 0.42, "source": "incidente"}'
   ```
   Com o pool ligado, o job `fx.twap` volta a mandar no período seguinte. Mantenha a trava até lá.
3. Conferir as conversões do período suspeito. Estorno só com a decisão do comandante e do jurídico.
4. Desligar a trava, avisar e fazer o pós-incidente. Se o pool é raso demais, pensar em mais liquidez ou TWAP mais longo.
