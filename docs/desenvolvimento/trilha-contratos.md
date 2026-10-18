# Trilha — Smart Contracts

Pasta: [`contracts/`](../../contracts/README.md) · Especificação: [doc 07](../07-smart-contracts.md)

## Caminho de desenvolvimento

| Passo | Etapa | Contrato | O que fazer | Pronto quando |
|------:|-------|----------|-------------|---------------|
| 1 | 0 | — | Projeto Foundry, OpenZeppelin v5, Slither no CI, `forge fmt` | CI verde com teste de exemplo |
| 2 | 2 | `AvatarNFT` | ERC-721 + EIP-2981, papel `MINTER`, metadados via `baseURI` da API | Testes de mint e royalties |
| 3 | 2 | `LuckyBox` | Tiers, probabilidades on-chain, Chainlink VRF (testnet) | Distribuição em ±1% em teste estatístico |
| 4 | 2 | `LandNFT` | `lotId(x,y)`, `buyPrimary(quote, sig)` com EIP-712, nonce e prazo | Cotação do serviço World aceita |
| 5 | 2 | `PropertyNFT` | Mint e upgrade por voucher, vínculo ao lote âncora | Testes de voucher inválido ou expirado |
| 6 | 3 | `SCityToken` | BEP-20 de oferta fixa + Permit; sem mint posterior | Invariante: `totalSupply` constante |
| 7 | 3 | `TokenVesting` | Uma `VestingWallet` por beneficiário conforme o [doc 04 §2](../04-economia-tokenomics.md#2-distribuição-do-scity-tokenomics-fgv-jr) | Cronograma simulado bate com a tabela |
| 8 | 3 | `GameVault` | Depósito, `claim(voucher)`, limites diário e por endereço, pausa, troca de signer por timelock | Fuzz de limites e de replay |
| 9 | 3 | `Marketplace` | Preço fixo, leilão, bundle, taxa, royalties | Venda em combo atômica |
| 10 | 3 | — | **Auditoria externa** e correções | Relatório sem críticos ou altos em aberto |
| 11 | 4 | — | Deploy na mainnet por script, verificação no BscScan, multisig e timelock, `deployments/bsc.json` | Endereços publicados |
| 12 | 5 | `StakingPool` | Epochs, lock com boost, recompensas | Auditoria complementar |

## Estrutura

```
contracts/
├─ src/          ← contratos
├─ test/         ← unitários, fuzz e invariantes
├─ script/       ← DeployLocal, DeployTestnet, DeployMainnet
├─ deployments/  ← <rede>.json com endereços e blocos de deploy
├─ out/abi/      ← ABIs exportadas (gerado no CI)
└─ foundry.toml
```

## Redes

| Ambiente | Rede | Chain ID |
|----------|------|---------:|
| local | anvil | 31337 |
| dev / staging | BSC Testnet | 97 |
| produção | BNB Smart Chain | 56 |

Chaves de deploy: nunca em `.env` versionado. Testnet com chave de deploy própria; mainnet com deploy assinado pela multisig ou por chave de hardware.
