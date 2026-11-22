# Pacote do auditor (E3.8)

O que a auditoria externa dos contratos precisa saber, antes da mainnet ([doc 07 §5](../07-smart-contracts.md#5-qualidade-e-segurança)). A auditoria em si é de terceiros. Este pacote é a preparação, e o commit congelado vai junto com o pedido ao auditor.

## 1. Escopo

Rede de destino: BNB Smart Chain. Solidity 0.8.28 (`evm_version = cancun`), OpenZeppelin Contracts e Contracts Upgradeable **5.7.0** e Chainlink VRF v2.5.

| Contrato | nSLOC | Prioridade | Upgrade |
|---|---:|---|---|
| [`GameVault`](../../contracts/src/GameVault.sol) | 152 | **Principal** (doc 07) | UUPS atrás do timelock |
| [`Marketplace`](../../contracts/src/Marketplace.sol) | 405 | **Principal** (doc 07) | UUPS atrás do timelock |
| [`LuckyBox`](../../contracts/src/LuckyBox.sol) e [`lib/Payment`](../../contracts/src/lib/Payment.sol) | 156 + 20 | **Principal** (doc 07) | Imutável |
| [`LandNFT`](../../contracts/src/LandNFT.sol) | 136 | Recomendado: venda primária e apreensão por voucher | Imutável |
| [`PropertyNFT`](../../contracts/src/PropertyNFT.sol) | 149 | Recomendado: mint, nível e apreensão por voucher | Imutável |
| [`BuildingNFT`](../../contracts/src/BuildingNFT.sol) | 127 | Recomendado: mint por voucher e demolição | Imutável |
| [`AvatarNFT`](../../contracts/src/AvatarNFT.sol) | 60 | Recomendado: mint só pela LuckyBox | Imutável |
| [`SCityToken`](../../contracts/src/SCityToken.sol) | 9 | Leitura: ERC-20 + Permit da OZ, suprimento fixo | Imutável |

Total: cerca de 1.200 nSLOC.

**Fora do escopo:**
- `src/dev/` (VRF e par de DEX locais, só para o anvil);
- `script/`;
- os testes;
- os serviços off-chain.

O doc 07 cita um `StakingPool`, que **ainda não existe**: entra numa rodada própria quando for escrito.

## 2. Como o sistema funciona

- **Servidor autoritativo** ([ADR-0002](../adr/0002-servidor-autoritativo.md)): o jogo roda off-chain. Na blockchain fica só a posse (NFTs e SCITY) e o dinheiro que entra e sai.
- **Vouchers EIP-712:** o backend (`SIGNER_ROLE`, chave em KMS na mainnet) assina:
  - a cotação de lote (`LandNFT.buyPrimary`);
  - o mint e o nível de imóvel (`PropertyNFT`);
  - o prédio (`BuildingNFT`);
  - o saque (`GameVault.claim`);
  - a apreensão por imposto (`seize`, [ADR-0016](../adr/0016-apreensao-nft-leilao.md)).
  - Cada voucher tem prazo e nonce de uso único.
- **GameVault:** o depósito emite `Deposited`, e o chain-indexer credita o ledger uma vez, pela transação e pelo log. O saque é debitado antes no ledger e resgatado com o voucher. O teto diário (total e por endereço) é o circuit breaker. O destinatário pode desistir (`cancelVoucher`).
- **Marketplace:**
  - **Preço fixo:** os NFTs ficam com o vendedor, aprovados, e o SCITY vai direto do comprador ao vendedor, à tesouraria e aos royalties.
  - **Leilão:** os NFTs e o maior lance ficam guardados no contrato, o lance anterior volta na hora, e o encerramento é aberto a qualquer um. Se algum NFT saiu do contrato (apreensão), o leilão se desfaz.
- **LuckyBox:** paga e pede o VRF. O callback sorteia raridade e profissão e minta o avatar.

## 3. Papéis e poderes

| Contrato | Papel | Quem (mainnet) | Pode |
|---|---|---|---|
| GameVault, Marketplace | `UPGRADER_ROLE` | `TimelockController` (48 h, o multisig 3-de-5 propõe e executa, sem admin) | Trocar a implementação |
| Todos | `DEFAULT_ADMIN_ROLE` | Multisig 3-de-5 (atrás do timelock para parâmetros, doc 07 §3) | Dar papéis; limites do cofre; taxa e coleções do mercado; tesouraria, VRF, tiers e profissões da caixa; base URI |
| Todos com pausa | `PAUSER_ROLE` | Multisig 2-de-3 | Pausar e despausar. A pausa no Marketplace **não** trava o `cancelAuction`, e no cofre não trava o `cancelVoucher` |
| GameVault, LandNFT, PropertyNFT, BuildingNFT | `SIGNER_ROLE` | Chave KMS do backend | Assinar vouchers (não move fundos sozinho) |
| AvatarNFT | `MINTER_ROLE` | Contrato LuckyBox | Mintar avatar |
| Marketplace | admin em `cancelAuction` | Multisig | Cancelar leilão com lance (moderação), devolvendo o lance |

## 4. Premissas de confiança

- **Chave do signer:** se vazar, quem a tem emite saques até o teto diário do cofre (o circuit breaker limita o estrago) e cotações de lote. A resposta é pausar e trocar o `SIGNER_ROLE` pelo timelock.
- **SCITY:** ERC-20 padrão, sem taxa na transferência nem rebase. O cofre e o mercado contam com isso.
- **Coleções do mercado:** só as permitidas pelo admin (os NFTs do projeto). Uma coleção maliciosa conseguiria travar só as próprias listagens (ver *calls-loop* abaixo).
- **Externos:** Chainlink VRF (o coordenador) e a tesouraria (do projeto) são confiáveis.
- **Prazos:** usam `block.timestamp`. Alguns segundos de desvio do validador não mudam o resultado.

## 5. Invariantes

Os testes de invariantes (fuzz com estado) ficam em [`contracts/test/invariants`](../../contracts/test/invariants). Cada um roda 128 sequências de 64 chamadas.

| Invariante | Teste |
|---|---|
| O saldo do cofre é a reserva + os depósitos − os saques pagos | `GameVault.invariant.t.sol` `invariant_balanceMatchesFlows` |
| Nenhum dia passa do teto total, e nenhum endereço do teto por endereço | `invariant_dailyLimits` |
| Voucher cancelado nunca é pago, e o nonce fica marcado | `invariant_cancelledNeverPaid` |
| O SCITY no mercado é a soma dos maiores lances dos leilões abertos | `Marketplace.invariant.t.sol` `invariant_escrowEqualsOpenBids` |
| Todo NFT guardado no mercado é de exatamente um leilão aberto | `invariant_heldNftsBelongToOpenAuctions` |
| O SCITY entre atores, tesouraria e mercado se conserva | `invariant_scityConserved` |

Os handlers contam os caminhos de verdade (compras, lances, encerramentos, desistências), visíveis com `-vv`, para garantir que o fuzz chega neles.

## 6. Qualidade

- **Testes:** 115 no Foundry (unidade, fuzz, invariantes e upgrade), no CI a cada PR.
- **Cobertura de linhas:** 100% no GameVault, no Marketplace e na LuckyBox, com piso de 95% no CI (`scripts/coverage-gate.mjs`). O total de `src/` é 95,3%.
- **Slither no CI**, falhando com achado alto. Triagem de 2026-11-22: **0 alto, 0 médio, 31 baixos** (abaixo).
- **Upgrade:** [`test/Upgrades.t.sol`](../../contracts/test/Upgrades.t.sol) confere:
  - a implementação travada;
  - só o timelock atualizando, depois do atraso;
  - o estado preservado;
  - a recusa de uma implementação sem UUPS.

### Triagem do Slither (baixos aceitos)

| Detector | Onde | Por que fica |
|---|---|---|
| `calls-loop` | Marketplace: `list`, `buy`, `createAuction`, `settle`, `_unwind`, `_royalty` | Laço de até `MAX_ITEMS` (5) sobre coleções permitidas pelo admin. Uma coleção que reverte só trava a própria operação. `_royalty` usa `try/catch` e uma coleção quebrada paga royalty 0 (teste em `Edges.t.sol`) |
| `reentrancy-benign` | `LuckyBox.open` | `nonReentrant`. As chamadas vão para a tesouraria do projeto e para o coordenador VRF, e o id do pedido só existe depois da chamada |
| `reentrancy-events` | `LuckyBox.rawFulfillRandomWords` | `fulfilled` é gravado antes do `mint`, e o `AvatarNFT` usa `_mint` (sem callback ao comprador) |
| `timestamp` | Prazos dos vouchers, das listagens e dos leilões | Ver as premissas de confiança |

**`forge lint`** dá 15 avisos `reentrancy-events` no GameVault e no Marketplace depois do UUPS. São falsos positivos: o linter trata o armazenamento com namespace das bases upgradeable (`_grantRole`, `__X_init`) como chamada externa, até no `initialize`. O Slither, que analisa o fluxo de dados, não os aponta.

## 7. Riscos conhecidos e decisões

- **Poder do admin:** o admin pode baixar os limites do cofre abaixo do que já saiu no dia. Nesse caso o `claim` reverte com disponível 0, sem underflow (teste em `GameVault.t.sol`). O admin também cancela leilão com lance, por moderação.
- **Voucher e teto:** um voucher válido pode não ser resgatável no dia por causa do teto. Ele vale até o prazo, ou o destinatário desiste.
- **Apreensão no leilão:** um NFT apreendido no meio de um leilão desfaz o leilão (o lance volta) em vez de travar.
- **Upgrade:** as variáveis só podem crescer no fim. As bases da OZ usam ERC-7201. Valor na declaração não vale no proxy: os contadores do Marketplace começam em 1 no `initialize` (achado corrigido no #82).
- **Fora do contrato:** a regra de bairro do mercado fica só no jogo ([ADR-0014](../adr/0014-decisoes-produto-mvp.md)).

## 8. Como rodar

```bash
cd contracts
forge test                                  # tudo, com invariantes
forge test --match-path "test/invariants/*" -vv   # invariantes, com a contagem dos caminhos
forge coverage --report summary --no-match-coverage "(script|test|lib|dev)"
```

O Slither roda no CI (`.github/workflows/ci.yml`, job `slither`, configuração em `contracts/slither.config.json`). O deploy local está no [README dos contratos](../../contracts/README.md#rede-local-anvil).

## 9. Antes de enviar

- [ ] Congelar o commit (tag `auditoria-v1`) e mandar o hash.
- [ ] Parâmetros da mainnet: endereços do multisig (3-de-5 e 2-de-3), atraso de 48 h do timelock, tesouraria, assinatura do VRF (key hash e sub id), tetos do cofre e taxa do mercado.
- [ ] Script de deploy da mainnet (hoje só existe o `DeployLocal`).
- [ ] Contato técnico e janela de perguntas.
- [ ] Depois do relatório: corrigir, registrar cada achado e a resposta, e auditar de novo o que mudou.
