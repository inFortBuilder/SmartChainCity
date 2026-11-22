# contracts

Smart contracts da BNB Smart Chain, em Foundry com OpenZeppelin v5.7 e Solidity 0.8.28.

- Caminho de desenvolvimento: [docs/desenvolvimento/trilha-contratos.md](../docs/desenvolvimento/trilha-contratos.md)
- Especificação: [docs/07](../docs/07-smart-contracts.md)

Mudanças aqui exigem 2 aprovações. Os endereços implantados ficam em `deployments/<rede>.json`.

## O que já existe

| Contrato | O que faz |
|----------|-----------|
| [`LandNFT`](src/LandNFT.sol) | Lote da cidade (ERC-721). O `tokenId` é `cidade << 32 \| lote`, o mesmo par (cidade, lote) do serviço world, e pode ser desfeito com `lotOf`. A venda primária usa `buyPrimary(cotação, assinatura)`: o world assina a cotação (EIP-712), e o contrato confere assinatura, comprador, preço, prazo e nonce. O pagamento vai direto para a tesouraria, em BNB ou num token. Com preço 0, o lote já foi pago no ledger do jogo e o contrato só registra a posse. A transferência é livre ([ADR-0014](../docs/adr/0014-decisoes-produto-mvp.md)), com uma exceção: `seize(Seizure, assinatura)` leva o lote ao vencedor do leilão por imposto, de quem o tiver, com a apreensão assinada pelo world ([ADR-0016](../docs/adr/0016-apreensao-nft-leilao.md)) |
| [`AvatarNFT`](src/AvatarNFT.sol) | Smartcityano (ERC-721 com royalties EIP-2981, 2,5% para a tesouraria). Raridade (0 a 3) e profissão ficam gravadas no mint. A profissão é o código do catálogo em `bytes32` (ex.: `padeiro`), o mesmo do Strapi. Só quem tem o papel `MINTER` cria avatares |
| [`LuckyBox`](src/LuckyBox.sol) | Caixas por tier: moeda, preço e tabela de probabilidades por raridade, pública on-chain. `open` cobra e pede um número ao Chainlink VRF v2.5; o callback sorteia a raridade e a profissão e cria o avatar. A tabela vale como estava no momento da compra |
| [`BuildingNFT`](src/BuildingNFT.sol) | Prédio de construtor (doc 13 §7). Guarda o lote, o hash do GLB aprovado (`modelHash`), os andares e o construtor. O mint usa o voucher EIP-712 do world, dado só a prédio com alvará. O construtor precisa ser dono do lote no `LandNFT`, e cada lote tem no máximo um prédio vigente. `demolish` (dono do prédio e do lote) libera o lote |
| [`PropertyNFT`](src/PropertyNFT.sol) | Imóvel do catálogo (Casa T1 e os próximos) sobre um lote âncora (doc 07 §2.2). Guarda o lote, o tipo (`bytes32`, ex.: `t1`) e o nível; desgaste e renda ficam no world. O id do token é o id do imóvel no world (os 128 bits do UUID), então o mesmo imóvel não vira dois tokens. O mint usa o voucher do world, dado só a imóvel pronto, e exige que a carteira seja dona do lote no `LandNFT`; um imóvel por lote. `upgrade` leva o nível novo com outro voucher e só aceita nível maior. Depois do mint, a transferência é livre, salvo a apreensão do leilão (`seize`, [ADR-0016](../docs/adr/0016-apreensao-nft-leilao.md)) |
| [`GameVault`](src/GameVault.sol) | Cofre do SCITY entre a carteira e o jogo (doc 07 §2.4). `deposit` (ou `depositWithPermit`, com a assinatura EIP-2612 do SCITY, numa transação só) guarda o SCITY e emite `Deposited`; o chain-indexer credita no ledger depois das confirmações. `claim` paga o saque assinado pelo servidor (EIP-712, um nonce por voucher), só para o destinatário; `cancelVoucher` deixa o destinatário desistir, e o servidor devolve o SCITY ao jogo. Circuit breaker: teto de saque por dia, no total e por endereço, com `available` para ver quanto ainda sai hoje; pausa. Proxy UUPS atrás do timelock ([upgrade](#upgrade-uups-atrás-do-timelock)) |
| [`SCityToken`](src/SCityToken.sol) | SCITY: ERC-20 com Permit e oferta fixa de 1 bilhão, criada uma única vez no deploy. Não tem função de mint |
| [`LocalVRFCoordinator`](src/dev/LocalVRFCoordinator.sol) | Coordenador VRF **só para o anvil e os testes**: qualquer um entrega o sorteio. Na BSC entra o coordenador real da Chainlink |

O VRF usa uma interface mínima ([`src/vrf/VRFV2Plus.sol`](src/vrf/VRFV2Plus.sol)), com os mesmos campos do `VRFV2PlusClient` oficial. O pacote da Chainlink não instala no Windows, porque os caminhos dos arquivos passam do limite de tamanho, e só esta parte é necessária.

**Provisório:**
- As probabilidades do tier de teste são 40/30/20/10%, as mesmas fatias do simulador. A tabela do whitepaper não está nas fontes (doc 02 §2).
- A Lucky Box depende do parecer jurídico (E0.8).

### Marketplace (E3.6)

[`Marketplace`](src/Marketplace.sol) é o mercado secundário, com preço fixo em SCITY (doc 07 §2.5).

| Regra | Como |
|---|---|
| Listar | `list(items, price, expiresAt)`: de 1 a 5 NFTs de coleções permitidas (`setCollection`) por um preço só. Mais de um é o combo (lote + imóvel). O NFT fica na carteira: o vendedor só aprova o contrato (`setApprovalForAll`). Um NFT tem uma listagem viva por vez; se o dono mudou fora do mercado, o novo dono lista e a velha fecha |
| Comprar | `buy(listingId, maxPrice)`: o comprador aprova o SCITY antes. Saem a taxa do protocolo (`feeBps`, 2,5%, para a tesouraria; teto de 10%) e o royalty EIP-2981 de cada NFT que o declara, sobre a parte dele no preço. O resto vai para o vendedor, e todos os NFTs passam juntos. `maxPrice` protege contra troca de preço |
| Recusa | Venda vencida, preço acima de `maxPrice`, compra da própria listagem e vendedor que já não tem algum dos NFTs (`ListingStale`: vendeu fora ou o leilão apreendeu, [ADR-0016](../docs/adr/0016-apreensao-nft-leilao.md)) |
| Cancelar | O vendedor, ou o admin (moderação) |
| Leiloar | `createAuction(items, startPrice, duration)`, de 1 h a 14 dias: os NFTs ficam guardados no contrato até o fim, e uma venda a preço fixo do mesmo NFT é cancelada. No jogo, a posse segue com o vendedor até o fim |
| Lance | `bid(auctionId, amount)`: o SCITY fica guardado no contrato, e o lance anterior volta na hora. O mínimo é o preço inicial ou 5% acima do maior (`minimumBid`). Um lance nos últimos 10 minutos estica o fim para 10 minutos depois dele |
| Encerrar | `settle(auctionId)`, chamado por qualquer um depois do fim. Com lance, separa taxa, royalties e vendedor, como na venda, e entrega os NFTs ao vencedor; sem lance, eles voltam ao vendedor. Se algum NFT saiu do contrato (apreensão do leilão por imposto), o lance volta e o resto volta ao vendedor |
| Cancelar leilão | `cancelAuction`: o vendedor, enquanto não há lance; o admin, sempre (moderação), devolvendo o lance |
| Pausa | `PAUSER_ROLE` para listar, comprar, leiloar, dar lance e encerrar |

A regra de bairro fica só no jogo ([ADR-0014](../docs/adr/0014-decisoes-produto-mvp.md)). Proxy UUPS atrás do timelock ([upgrade](#upgrade-uups-atrás-do-timelock)). O `DeployLocal` cria o mercado por último, com taxa de 2,5% para o deployer e o lote, o imóvel e o avatar permitidos.

## Upgrade: UUPS atrás do timelock

Só o `GameVault` e o `Marketplace` são atualizáveis (doc 07 §5); token e NFTs são imutáveis.

- **Proxy:** cada um é um proxy ERC-1967 com implementação UUPS. O endereço que os serviços usam é o do proxy, e o estado mora nele.
- **Implementação:** nasce travada (`_disableInitializers`) e é configurada uma vez só por `initialize(admin, upgrader, …)`.
- **Quem troca a implementação:** só o `UPGRADER_ROLE` (`upgradeToAndCall`), e esse papel é do `TimelockController`.
  - Na mainnet: atraso de 48 h, o multisig 3-de-5 propõe e executa, e o timelock não tem admin (doc 07 §3).
  - No anvil: atraso 0, e o deployer propõe e executa.
- **Outros papéis:** na mainnet, o `DEFAULT_ADMIN` (limites, taxa, coleções) também fica com o timelock e o `PAUSER` com o multisig 2-de-3 ([deploy na BSC](#deploy-na-bsc-mainnet-e-testnet)). No anvil, os dois ficam com o deployer.
- **Armazenamento:** as bases da OpenZeppelin usam namespace (ERC-7201). As variáveis destes contratos só podem ganhar novas **no fim**, sem mudar a ordem nem o tipo das que já existem.
- **Valor na declaração não vale no proxy.** `nextListingId` e `nextAuctionId` começam em 1 dentro do `initialize` (o teste de upgrade confere).
- **Reentrância:** o `ReentrancyGuard` da OZ 5.7 é `@custom:stateless` (ERC-7201) e serve no proxy sem inicializar.

`test/Upgrades.t.sol` confere:
- a implementação travada e a inicialização única;
- que nem o admin nem um estranho atualizam direto;
- que só o multisig propõe no timelock;
- que antes do atraso a execução recusa;
- o estado preservado na versão 2;
- a recusa de uma implementação que não é UUPS.

## Deploy na BSC (mainnet e testnet)

`script/DeployMainnet.s.sol` sobe tudo na BNB Smart Chain (56) ou na testnet (97) e entrega os papéis do doc 07 §3. Em outra rede, recusa.

| Papel | Fica com |
|---|---|
| `DEFAULT_ADMIN_ROLE` de todos os contratos | `TimelockController` (atraso ≥ 48 h na mainnet; o multisig 3-de-5 propõe e executa; sem admin) |
| `UPGRADER_ROLE` do `GameVault` e do `Marketplace` | O mesmo timelock |
| `PAUSER_ROLE` | Multisig 2-de-3 (pausa na hora, sem esperar o atraso) |
| `SIGNER_ROLE` do `LandNFT`, `PropertyNFT`, `BuildingNFT` e `GameVault` | A chave do backend no KMS |
| `MINTER_ROLE` do `AvatarNFT` | A `LuckyBox` |

**O deployer sai sem papel nenhum.** Ele é admin só durante o script, para configurar a caixa (tier 1 e profissões do seed do CMS), as coleções do mercado e os signers. No fim, o script confere cada papel na cadeia e reverte se o deployer ficou com algum, se o multisig tem admin direto ou se falta algo.

**Configuração:** um JSON no formato de [`deploy/bsc.example.json`](deploy/bsc.example.json), sem nada secreto (só endereços e parâmetros):
- os dois multisigs (têm de ser contratos, isto é, Safes já criados, e diferentes entre si);
- o endereço do signer no KMS e a tesouraria;
- o `scity`, que é o token do [TGE](#tge-vesting-e-lp-travado-e42) já criado. Na mainnet é obrigatório. Na testnet, o `tokenRecipient` serve de atalho: o script cria o token com o suprimento inteiro para ele, sem vesting;
- o atraso do timelock, os tetos do cofre, a taxa do mercado (até 10%), o royalty dos avatares e as base URIs;
- a assinatura do Chainlink VRF v2.5 (coordenador, key hash, sub id) e o tier 1 da caixa (pesos somando 10.000).

O script recusa endereço zero, o deployer como signer, tesouraria ou multisig e, na mainnet, atraso abaixo de 48 h.

```bash
cd contracts
cp deploy/bsc.example.json deploy/bsc-testnet.local.json   # preencher; *.local.json fica fora do git
DEPLOY_CONFIG=deploy/bsc-testnet.local.json forge script script/DeployMainnet.s.sol   --rpc-url "$BSC_TESTNET_RPC" --broadcast --verify --ledger
```

- **Chave do deployer:** carteira de hardware (`--ledger`) ou keystore (`--account`). Nunca `--private-key` na linha de comando.
- **Verificação no BscScan:** `--verify` lê `ETHERSCAN_API_KEY` do ambiente.
- **Mainnet:** também precisa de `CONFIRM_MAINNET=sim`.
- **Depois do deploy:**
  - Os endereços ficam em `deployments/<chainId>.json`.
  - Adicionar a `LuckyBox` como consumidora da assinatura do VRF.
  - Depositar a reserva do cofre (SCITY no `GameVault`).
  - Configurar os serviços com os endereços.
- **Custo medido no ensaio:** cerca de 30 M de gás, ou 0,06 BNB a 2 gwei.

`test/DeployMainnet.t.sol` confere:
- os papéis finais;
- a pausa imediata pelo multisig 2-de-3;
- que o multisig de admin não muda parâmetro direto, só pelo timelock e depois do atraso;
- a recusa das configurações erradas;
- as redes aceitas;
- a leitura do JSON de exemplo.

Ensaio: `anvil --chain-id 97`, com os dois Safes simulados por `anvil_setCode`. Depois do ensaio, `hasRole` foi conferido na cadeia em cada contrato: o deployer sem admin nem pausa, e o timelock com admin.

## TGE, vesting e LP travado (E4.2)

O TGE roda **antes** do `DeployMainnet`, que recebe o token criado aqui. É `script/DeployTGE.s.sol` com uma config como [`deploy/tge.example.json`](deploy/tge.example.json): os valores do doc 04 §2, faltando os endereços.

- **`TgeDistributor`** (`src/tge/`): o TGE inteiro numa transação só.
  - O construtor cria o `SCityToken` com 1 bilhão para si e distribui tudo.
  - Termina com saldo zero, e o deployer não recebe nada (o script confere).
  - Se a soma das alocações não der 1 bilhão, reverte.
  - Fica como registro público: `grants()` lista nome, beneficiário, carteira de vesting, valor no TGE e valor em vesting.
- **Vesting:** uma `VestingWallet` da OZ por alocação.
  - O `tgeBps` vai direto ao beneficiário no TGE.
  - O resto libera em linha reta de `TGE + cliff` até `TGE + cliff + duração` (mês = 365 dias / 12).
  - Com duração zero, vai tudo direto: liquidez, ação social e airdrop.
  - O beneficiário deve ser um Safe por grupo, ou uma carteira por pessoa (basta uma entrada por beneficiário na config).
- **`RewardsPool`:** o Play-to-Earn (41%) em parcelas anuais de 30%, 25%, 20%, 15% e 10% (doc 04 §3). A primeira destrava no TGE.
  - Qualquer um chama `release()`, e o SCITY vai só ao beneficiário, o Safe do P2E, que abastece a reserva do `GameVault`.
  - O cronograma é imutável: passar para liberação semestral exige decidir antes do TGE, com outros `tranchesBps` e `intervalDays`.
- **Staking (20%):** linear em 60 meses para o Safe do staking, até o `StakingPool` existir.
- **`TokenLock` (LP travado):** trava o LP do par SCITY na DEX por **no mínimo 365 dias**.
  - O contrato recusa prazo menor.
  - O beneficiário, o Safe da liquidez, só pode estender o prazo, e qualquer um confere `releaseTime` e o saldo na cadeia.

| Alocação | SCITY | No TGE | Depois |
|---|---:|---:|---|
| Play-to-Earn | 410 mi | 30% (123 mi) | +25%, +20%, +15%, +10% a cada ano |
| Staking | 200 mi | 0 | 60 meses linear |
| DEV / Team | 95 mi cada | 0 | Cliff de 12 meses + 24 meses linear |
| Marketing | 70 mi | 10% | 36 meses linear |
| Liquidez | 30 mi pool + 30 mi reserva | 100% | O LP do pool vai ao `TokenLock` |
| ICO | 35 mi | 25% | 6 meses linear |
| Advisors | 10 mi | 0 | Cliff de 6 meses + 18 meses linear |
| Ação Social / AirDrop | 10 mi cada | 100% | — |
| STAFF | 5 mi | 0 | Cliff de 6 meses + 12 meses linear |

**Ordem do lançamento:**

1. Criar os Safes (um por alocação ou grupo, mais o de admin 3-de-5 e o de pausa 2-de-3) e preencher `deploy/tge.local.json`.
2. Rodar o TGE:
   ```bash
   TGE_CONFIG=deploy/tge.local.json forge script script/DeployTGE.s.sol --rpc-url "$BSC_RPC" --broadcast --verify --ledger
   ```
   Na mainnet, também `CONFIRM_MAINNET=sim`. Os endereços vão para `deployments/<chainId>-tge.json`.
3. Rodar o `DeployMainnet` com `scity` = o `SCityToken` do passo 2.
4. O Safe da liquidez cria o par na DEX (PancakeSwap) com os 30 mi do pool e recebe o LP.
5. Travar o LP:
   ```bash
   LP_TOKEN=0x… LP_BENEFICIARY=<Safe da liquidez> LP_LOCK_DAYS=365 \
     forge script script/DeployTGE.s.sol --sig "lockLiquidity()" --rpc-url "$BSC_RPC" --broadcast --verify --ledger
   ```
   O prazo ganha 1 dia de folga, porque o bloco minerado vem depois da simulação.
6. O Safe da liquidez transfere **todo** o LP para o `TokenLock`.
7. Publicar os endereços: `deployments/56-tge.json`, `56.json` e `56-lp-lock.json`, no site e na documentação pública (E4.5).

`test/Tge.t.sol` confere com a config de exemplo:
- o cronograma simulado batendo com a tabela em 0, 6, 12, 24 e 36 meses;
- o P2E ano a ano (123, 225,5, 307,5, 369 e 410 mi acumulados);
- a soma exata e nenhum saldo sobrando;
- as configurações recusadas;
- a trava do LP: mínimo de 12 meses, só estender, só o beneficiário recebe.

**Ensaio num `anvil --chain-id 97`:**
- TGE numa transação de cerca de 8,9 M de gás;
- `DeployMainnet` com o token do TGE;
- `lockLiquidity` (prazo de cerca de 366 dias);
- o deployer terminou com 0 SCITY.

## Resposta a incidentes

`scripts/safe-lote.mjs` gera o JSON do Transaction Builder do Safe a partir de `deployments/<chainId>.json`, sem chave nenhuma:
- `pausar` e `despausar`: os 6 contratos com pausa, assinados pelo Safe 2-de-3;
- `trocar-signer --antigo --novo`: dois lotes do timelock, agendar e executar, para tirar o `SIGNER_ROLE` da chave vazada e dar à nova nos 4 contratos que conferem voucher.

A codificação é conferida com o `cast calldata` (`scripts/safe-lote.test.mjs`, no CI) e foi ensaiada num anvil com chain id 97. Os runbooks ficam em [docs/incidentes](../docs/incidentes/README.md).

## Rodar

Instale o [Foundry](https://getfoundry.sh) (1.9 ou mais novo). Depois, nesta pasta:

```bash
git submodule update --init --recursive
```

```bash
forge test
```

```bash
forge fmt --check
```

São 51 testes. Entre eles:
- o fuzz do `tokenId` de lote;
- a invariante de `totalSupply` constante;
- a distribuição das raridades dentro de ±1% em 40 mil sorteios;
- a recusa de cotação vencida, alterada, reutilizada, de outro assinante ou usada por outro comprador.

## Rede local (anvil)

Num terminal, suba o anvil:

```bash
anvil
```

Em outro terminal, nesta pasta:

```bash
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

O script:
- sobe os nove contratos e o par de teste da DEX (o `BuildingNFT`, o `PropertyNFT`, o `GameVault`, o par da DEX e o `Marketplace` por último, para os outros endereços não mudarem);
- põe 1 milhão de SCITY no `GameVault` como reserva de saque, com tetos de 1 milhão por dia e 10 mil por endereço (**premissa**);
- dá ao `LuckyBox` o papel de criar avatares;
- carrega as 44 profissões do seed do CMS (`cms-strapi/seed/profissoes.json`), separadas por raridade;
- cria o tier 1 (0,05 BNB);
- cria um par SCITY/dólar de teste para o TWAP do câmbio: `LocalUSD` e `LocalDexPool` ([`src/dev/LocalDexPool.sol`](src/dev/LocalDexPool.sol)), a US$ 1. O pool tem o oráculo da PancakeSwap V3 (`observe`), mas não troca tokens: o preço muda com `setTick`;
- grava os endereços em [`deployments/anvil.json`](deployments/anvil.json).

Num anvil recém-iniciado, os endereços são sempre os mesmos. `WORLD_SIGNER` define quem assina as cotações de lote; sem ela, é o próprio deployer.

Para abrir uma caixa e ver o avatar, use o `cast`. Primeiro, abra a caixa com a conta 1 do anvil:

```bash
cast send 0x5FC8d32690cc91D4c39d9d3abcBD16989F875707 "open(uint32)" 1 --value 0.05ether --unlocked --from 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

Depois, entregue o sorteio pelo coordenador local:

```bash
cast send 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 "fulfill(uint256)" 1 --unlocked --from 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

Por fim, leia a raridade e a profissão do avatar:

```bash
cast call 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 "traitsOf(uint256)((uint8,bytes32))" 1
```

## Cotação de lote (para o serviço world)

Domínio EIP-712:
- `name`: `SCC LandNFT`
- `version`: `1`
- `chainId` da rede
- `verifyingContract`: endereço do `LandNFT`

```
LotQuote(uint32 city,uint32 lot,address buyer,address currency,uint256 price,uint256 nonce,uint256 deadline)
```

Os campos:
- `city`: id numérico da cidade no world.
- `lot`: número do lote.
- `currency`: `0x0` para BNB, ou o endereço do token (SCITY, stablecoin).
- `price`: preço em wei; 0 quando o lote já foi pago no ledger.
- `nonce`: único por cotação.
- `deadline`: prazo em segundos Unix.

A carteira que chama `buyPrimary` precisa ser o `buyer` da cotação.

## Voucher de prédio (para o serviço world)

Domínio EIP-712:
- `name`: `SCC BuildingNFT`
- `version`: `1`
- `chainId` da rede
- `verifyingContract`: endereço do `BuildingNFT`

```
BuildingVoucher(uint256 lotId,address developer,bytes32 modelHash,uint16 floors,uint256 nonce,uint256 deadline)
```

Os campos:
- `lotId`: o `tokenId` do lote no `LandNFT`.
- `developer`: carteira do construtor; precisa ser quem chama `mint` e o dono do lote.
- `modelHash`: SHA-256 do GLB aprovado, que o SCC Builder devolve na validação.
- `nonce`: único por prédio.

Testado no anvil em 2026-11-20: o world assinou a cotação do lote e o voucher; a carteira do jogador comprou o lote e mintou o prédio, e o mesmo voucher foi recusado na segunda vez.

## Voucher de saque (GameVault)

Domínio EIP-712: `name` `SCC GameVault`, `version` `1`, `chainId` da rede e o endereço do cofre.

```
Withdrawal(address to,uint256 amount,uint256 nonce,uint256 deadline)
```

`amount` em wei de SCITY. Só `to` resgata, uma vez por `nonce`. Passou do teto do dia, o `claim` reverte com quanto ainda cabe (`DailyLimitExceeded`, `AddressLimitExceeded`), e o mesmo voucher pode ser resgatado no dia seguinte, se ainda estiver no prazo. O destinatário pode desistir com `cancelVoucher(w, sig)` (vale com o cofre pausado; o voucher precisa ser assinado pelo servidor): o nonce fica `nonceUsed` e `nonceCancelled`, e o economy devolve o SCITY ao jogo. Quem emite o voucher é o economy (`POST /v1/economy/withdrawals`).

Testado no anvil em 2026-11-20: a carteira depositou 40 SCITY duas vezes, e o chain-indexer creditou 80 SCITY na conta ligada a ela, sem repetir depois de refazer as projeções.

## Vouchers de imóvel (para o serviço world)

Domínio EIP-712: `name` `SCC PropertyNFT`, `version` `1`, `chainId` da rede e o endereço do `PropertyNFT`.

```
PropertyVoucher(uint256 tokenId,address owner,uint256 lotId,bytes32 typeCode,uint16 level,uint256 deadline)
LevelVoucher(uint256 tokenId,uint16 level,uint256 deadline)
```

Os campos:
- `tokenId`: o id do imóvel no world, os 128 bits do UUID.
- `owner`: carteira do dono; precisa ser quem chama `mint` e o dono do lote.
- `lotId`: o `tokenId` do lote no `LandNFT`.
- `typeCode`: código do tipo no catálogo, com zeros à direita.
- `level`: no mint, o nível atual; no `upgrade`, o nível novo, maior que o gravado.

Não há nonce: o mint não se repete porque o token já existe, e o upgrade não se repete porque o nível só sobe.

Testado no anvil em 2026-11-20: o world assinou o lote e o imóvel; a carteira comprou o lote, mintou a Casa T1, teve o mesmo voucher recusado e subiu para o nível 2.
