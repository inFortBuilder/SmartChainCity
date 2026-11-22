# Chave do signer vazada (SEV1)

O signer (chave do backend no KMS, `SIGNER_ROLE`) assina os vouchers de saque, cotação de lote, imóvel, prédio e apreensão. Com ele, um atacante:
- **saca** SCITY do cofre até o teto diário (o circuit breaker limita);
- **compra** lotes pela cotação.

**Sinais:**
- `Withdrawn` sem saque correspondente no economy;
- vouchers com nonce que o backend não emitiu;
- uso da chave no KMS fora do serviço;
- o alerta de saque estranho.

## 1. Estancar (minutos)

1. [Trava `withdrawals`](travas-do-economy.md): o backend para de emitir vouchers.
2. [Pausar tudo](pausar-contratos.md) pelo Safe 2-de-3. Os vouchers falsos não resgatam com o cofre e os NFTs pausados.
3. **Desligar a chave no KMS** (desabilitar, não apagar): a evidência fica.

## 2. Medir

- **Na cadeia:**
  - eventos `Withdrawn` do `GameVault` desde o primeiro sinal;
  - mints de `LandNFT` e `PropertyNFT` e as vendas primárias;
  - comparar com os saques e as cotações do economy e do world. O que não tem par no backend é do atacante.
- **Quanto saiu:** até o teto diário por endereço e total do cofre.
- **Destino:** para onde foram os fundos, para pedir bloqueio às corretoras, se for o caso.

## 3. Trocar a chave

1. Criar a chave nova no KMS, com política de acesso só para o serviço.
2. Gerar os lotes do timelock:
   ```bash
   cd contracts
   node scripts/safe-lote.mjs trocar-signer deployments/56.json --antigo 0x<vazada> --novo 0x<nova> > troca.json
   ```
   O resultado traz `agendar`, `executar` e o `salt`. Guardar os três: o `executar` só vale com o mesmo `salt`.
3. **Agendar:** o Safe 3-de-5 carrega `agendar` no Transaction Builder e executa. O timelock espera o atraso (48 h na mainnet).
4. **Durante o atraso:**
   - tudo segue pausado;
   - o economy e o world passam a assinar com a chave nova (configuração do KMS), mas a trava continua até a troca na cadeia.
5. **Executar:** depois do atraso, o Safe 3-de-5 carrega `executar`.
6. **Conferir** nos 4 contratos (`LandNFT`, `PropertyNFT`, `BuildingNFT`, `GameVault`):
   - `hasRole(SIGNER_ROLE, antiga)` é `false`;
   - `hasRole(SIGNER_ROLE, nova)` é `true`.

Ensaiado em 2026-11-22 num anvil com chain id 97:
- o agendamento pelo Safe de pausa foi recusado;
- a execução antes do atraso foi recusada;
- depois do atraso, a chave antiga saiu dos 4 contratos e a nova entrou.

## 4. Voltar

1. [Despausar](pausar-contratos.md) e desligar a trava `withdrawals`.
2. Os vouchers pendentes emitidos com a chave antiga **não resgatam mais**. O job de saques devolve o SCITY ao jogador quando eles vencem, e o jogador pode desistir antes (`cancelVoucher`).
3. Avisar ([encerramento](../comunicacao.md#4-encerrado)) e fazer o [pós-incidente](../pos-incidente.md).
4. Ressarcir pelo [plano](../README.md#6-ressarcimento), se algum jogador perdeu saldo.
