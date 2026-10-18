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
```solidity
// int32 → uint32 reinterpreta em complemento de dois: único e reversível (ver doc 03 §2)
function lotId(int32 x, int32 y) public pure returns (uint256) {
    return (uint256(uint32(x)) << 32) | uint256(uint32(y));
}

/// Venda primária: o servidor de mundo assina uma cotação válida
/// (região aberta, preço da região, regras de bairro e cerco já validadas off-chain).
function buyPrimary(LotQuote calldata q, bytes calldata sig) external;
// LotQuote { int32 x; int32 y; uint256 price; address buyer; uint256 deadline; uint256 nonce; }
```
- As regras de "1 bairro por região" e "não cercar terceiros" dependem do estado da grade e são **validadas off-chain**, com a cotação assinada (EIP-712) pelo serviço World. O contrato confere assinatura, preço, prazo e nonce.
- **Transferências secundárias** são livres no padrão ERC-721. Para manter a regra de bairro também no secundário, há duas opções (decisão no doc 11):
  - (a) `_update` override consultando um *registry* de restrições assinado; ou
  - (b) aceitar a transferência e aplicar a regra só no jogo (lote "excedente" não pode ser construído).

### 2.2 `PropertyNFT`
- `mint(voucher)` com `{owner, typeCode, level, anchorLotId}` assinado pelo servidor.
- `upgrade(tokenId, level, sig)` — nível no contrato; desgaste e renda ficam off-chain.
- Regra "não pode haver imóvel de terceiro no meu lote": no jogo, um imóvel só **rende** se o dono do imóvel for dono do lote âncora (ou tiver contrato de arrendamento). Venda em **combo** = transação atômica no `Marketplace` com dois NFTs.

### 2.3 `LuckyBox`
- Tiers de caixa com preço em SCITY (ou BNB/stablecoin) e tabela de probabilidades **pública on-chain**.
- `open()` → pede randomness ao **Chainlink VRF** → callback minta o `AvatarNFT` com raridade e profissão.
- Publicar as probabilidades é obrigatório por transparência e por regulação de loot boxes (doc 10).

### 2.4 `GameVault`
```solidity
function deposit(uint256 amount) external;                         // emite Deposited(account, amount)
function claim(Withdrawal calldata w, bytes calldata sig) external; // EIP-712
// Withdrawal { address to; uint256 amount; uint256 nonce; uint256 deadline; }
```
- Limite global diário de saída (circuit breaker) e por endereço.
- `pause()` controlado por multisig + timelock para mudanças de parâmetros.
- Chave do assinante em **KMS**, rotacionável (`setSigner` via timelock).

### 2.5 `Marketplace`
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
