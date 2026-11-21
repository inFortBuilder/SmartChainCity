# 07 — Smart Contracts

Rede: **BNB Smart Chain** (testnet para homologação). Ferramentas: Foundry ou Hardhat + OpenZeppelin Contracts v5.

## 1. Inventário

| Contrato | Padrão | Função |
|----------|--------|--------|
| `SCityToken` | BEP-20 (ERC-20) + `ERC20Permit` | Oferta fixa de 1 bi, mintada uma vez no deploy para os contratos de distribuição. **Sem função de mint posterior.** |
| `TokenVesting` | OZ `VestingWallet` por beneficiário | Team, DEV, Advisors, STAFF, Marketing, ICO (cronogramas do doc 04) |
| `RewardsPool` | Custom | Guarda o P2E (41%), libera por ano/semestre para o `GameVault` |
| `StakingPool` | Custom | Staking de SCITY (20%), recompensa por epoch, *lock* opcional com boost |
| `GameVault` | Custom + EIP-712 | Depósito SCITY → jogo; saque por voucher assinado; limites e pausa |
| `AvatarNFT` | ERC-721 + EIP-2981 | Smartcityanos; raridade e profissão inicial gravadas no mint |
| `LuckyBox` | Custom + Chainlink VRF | Venda de caixas por tier; o VRF sorteia raridade e profissão e minta o avatar |
| `LandNFT` | ERC-721 | Lotes; `tokenId` derivado de (x, y); venda primária por região |
| `PropertyNFT` | ERC-721 | Imóveis; vinculados a um lote âncora; nível e tipo |
| `VehicleNFT` | ERC-721 (opcional fase 2) | Carros e barcos raros |
| `Marketplace` | Custom | Listagem com preço fixo e leilão, taxa de protocolo, royalties EIP-2981 |
| `Treasury` | Gnosis Safe (multisig) | Recebe vendas primárias e taxas |

## 2. Detalhes

### 2.1 `LandNFT`
Implementado em [`contracts/src/LandNFT.sol`](../contracts/src/LandNFT.sol) (2026-11-20). Com a [ADR-0012](adr/0012-cidade-real-construtores.md), o lote é um polígono identificado no serviço world por (cidade, número do lote), e não mais por (x, y) numa grade.

```solidity
// cidade nos 32 bits altos, lote nos 32 baixos: único e reversível (lotOf)
function lotId(uint32 city, uint32 lot) public pure returns (uint256) {
    return (uint256(city) << 32) | uint256(lot);
}

/// Venda primária: o world assina uma cotação válida
/// (bairro aberto, preço da zona, regra de bairro e teto de área já validados off-chain).
function buyPrimary(LotQuote calldata q, bytes calldata sig) external payable;
// LotQuote { uint32 city; uint32 lot; address buyer; address currency; uint256 price; uint256 nonce; uint256 deadline; }
```
- A regra de bairro e o teto de área dependem do estado da cidade e são **validados off-chain**, com a cotação assinada (EIP-712) pelo serviço world. O contrato confere a assinatura, o comprador (quem chama), o preço, o prazo e o nonce.
- `currency` 0 é BNB; outro valor é o endereço do token (SCITY, stablecoin). Com `price` 0, o lote já foi pago no ledger do jogo, e o contrato só registra a posse on-chain.
- **Transferências secundárias** são livres no padrão ERC-721: a regra de bairro vale só no jogo (opção (b), decidida na [ADR-0014](adr/0014-decisoes-produto-mvp.md)).

### 2.2 `PropertyNFT`
- `mint(voucher)` com `{tokenId, owner, lotId, typeCode, level, deadline}` assinado pelo servidor. O `tokenId` é o id do imóvel no world, e a carteira precisa ser dona do lote no mint. Um imóvel por lote. **Pronto (2026-11-20).**
- `upgrade(voucher)` com `{tokenId, level, deadline}`: nível no contrato, só para cima; desgaste e renda ficam off-chain.
- Regra "não pode haver imóvel de terceiro no meu lote": no jogo, um imóvel só **rende** se o dono do imóvel for dono do lote âncora (ou tiver contrato de arrendamento). Venda em **combo** = transação atômica no `Marketplace` com dois NFTs.

### 2.3 `LuckyBox`
- Tiers de caixa com preço em SCITY (ou BNB/stablecoin) e tabela de probabilidades **pública on-chain**.
- `open()` → pede randomness ao **Chainlink VRF** → callback minta o `AvatarNFT` com raridade e profissão.
- Publicar as probabilidades é obrigatório por transparência e por regulação de loot boxes (doc 10).

### 2.4 `GameVault`

**Pronto no anvil (2026-11-20):** depósito, `claim` com voucher, tetos diários (total e por endereço), pausa e `setLimits`. Sem proxy por enquanto; o UUPS atrás de timelock entra antes da mainnet. O depósito credita **SCITY** no ledger (o mesmo que paga os lotes); a troca por THALER é a operação de câmbio.
```solidity
function deposit(uint256 amount) external;                         // emite Deposited(account, amount)
function claim(Withdrawal calldata w, bytes calldata sig) external; // EIP-712
// Withdrawal { address to; uint256 amount; uint256 nonce; uint256 deadline; }
```
- Limite global diário de saída (circuit breaker) e por endereço.
- `pause()` controlado por multisig + timelock para mudanças de parâmetros.
- Chave do assinante em **KMS**, rotacionável (`setSigner` via timelock).

### 2.5 `Marketplace`
**Pronto no anvil (2026-11-21):** listagem on-chain com preço fixo em SCITY, combo de até 5 NFTs na mesma transação, taxa de 2,5% para a tesouraria, royalties EIP-2981 e pausa ([contracts](../contracts/README.md#marketplace-e36)). O chain-indexer serve as listagens em `/v1/market/listings`. A tela no mapa também: painel Mercado, compra, venda pela ficha do lote e cancelamento. O leilão com prazo também: NFTs guardados no contrato, lances 5% acima com devolução na hora, extensão de 10 minutos e encerramento por qualquer um. Falta o proxy UUPS.
- Ordens assinadas off-chain (estilo Seaport simplificado) ou listagens on-chain simples no MVP.
- Taxa de protocolo proposta: 2,5% → Treasury; royalties EIP-2981 (proposto: 2,5% para o projeto em avatares e imóveis raros).
- Suporte a *bundle* (lote + imóvel).

## 3. Governança e controle de acesso

| Papel | Quem | Poderes |
|-------|------|---------|
| `DEFAULT_ADMIN` | Multisig 3-de-5 + Timelock 48 h | Trocar signers, parâmetros, pausas prolongadas |
| `PAUSER` | Multisig 2-de-3 | Pausa imediata em incidente |
| `SIGNER` | Chave KMS do backend | Assinar cotações e vouchers |
| `MINTER` | Contratos `LuckyBox`, `GameVault` | Mint de NFTs |

Liquidez inicial com **LP travado** (≥ 12 meses) e endereços da equipe publicados — resposta direta ao *rug pull* do CryptoCars.

## 4. Eventos que o indexer consome

`Deposited`, `Withdrawn`, `Transfer` (todos os ERC-721), `BoxOpened`, `AvatarRevealed`, `LotSold`, `PropertyMinted`, `PropertyUpgraded`, `Listed`, `Sale`, `Staked`, `Unstaked`, `RewardPaid`.

O Mafagafo foi criticado por **não emitir eventos** das taxas: todos os contratos devem emitir eventos de taxas, queimas e mudanças de parâmetro.

## 5. Qualidade e segurança

- Testes unitários e *fuzz* (Foundry) com cobertura ≥ 95% nas linhas críticas.
- Análise estática (Slither) no CI.
- **Auditoria externa** antes da mainnet, para `GameVault`, `LuckyBox`, `Marketplace` e `StakingPool`.
- Bug bounty após o lançamento.
- Contratos verificados no BscScan.
- Upgradeability: preferir contratos **imutáveis** para token e NFTs; usar proxy (UUPS) só em `GameVault` e `Marketplace`, sempre atrás de timelock.
