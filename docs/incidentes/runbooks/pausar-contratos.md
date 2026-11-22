# Pausar e despausar os contratos

A pausa é do **Safe 2-de-3** (`PAUSER_ROLE`) e tem efeito imediato, sem timelock ([DeployMainnet](../../../contracts/README.md#deploy-na-bsc-mainnet-e-testnet)).

| Contrato | A pausa trava | Continua funcionando |
|---|---|---|
| `GameVault` | Depósito e resgate de voucher | `cancelVoucher` (o jogador desiste e o SCITY volta ao jogo) |
| `Marketplace` | Listar, comprar, leiloar, dar lance | `cancelAuction` (o lance volta) |
| `LandNFT`, `PropertyNFT`, `BuildingNFT` | Mint e venda por voucher, transferências | — |
| `LuckyBox` | Abrir caixas | — |

O `AvatarNFT` não pausa: só a LuckyBox minta, e pausá-la basta.

## Gerar o lote

```bash
cd contracts
node scripts/safe-lote.mjs pausar deployments/56.json > pausar.json
node scripts/safe-lote.mjs despausar deployments/56.json > despausar.json
```

O arquivo não tem segredo: são os endereços e `pause()`/`unpause()`. Pode ser gerado **antes** do incidente e guardado no cofre da equipe, junto com o link do Safe.

## Executar

1. Abrir o Safe de pausa no app do Safe → **Transaction Builder** → *Load* → `pausar.json`.
2. Conferir os 6 endereços com `deployments/56.json` publicado. Outra pessoa confere também.
3. Criar o lote e coletar as 2 assinaturas. Executar.
4. Conferir na cadeia: `cast call <contrato> "paused()(bool)" --rpc-url $BSC_RPC` dá `true` nos 6.

Despausar segue o mesmo caminho, com `despausar.json` e a decisão do comandante.

## Ensaio

Feito em 2026-11-22 num `anvil --chain-id 97` com o `DeployMainnet`, com os dois Safes simulados (`anvil_setCode` e `anvil_impersonateAccount`):
- o lote **pausar** pelo Safe de pausa deixou os 6 contratos com `paused() = true`;
- o lote **despausar** voltou os 6;
- a codificação do lote do timelock é igual ao `cast calldata`, e o teste `scripts/safe-lote.test.mjs` roda no CI.
