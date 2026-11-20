# contracts

Smart contracts da BNB Smart Chain, em Foundry com OpenZeppelin v5.7 e Solidity 0.8.28.

- Caminho de desenvolvimento: [docs/desenvolvimento/trilha-contratos.md](../docs/desenvolvimento/trilha-contratos.md)
- Especificação: [docs/07](../docs/07-smart-contracts.md)

Mudanças aqui exigem 2 aprovações. Os endereços implantados ficam em `deployments/<rede>.json`.

## O que já existe

| Contrato | O que faz |
|----------|-----------|
| [`LandNFT`](src/LandNFT.sol) | Lote da cidade (ERC-721). O `tokenId` é `cidade << 32 \| lote`, o mesmo par (cidade, lote) do serviço world, e pode ser desfeito com `lotOf`. A venda primária usa `buyPrimary(cotação, assinatura)`: o world assina a cotação (EIP-712), e o contrato confere assinatura, comprador, preço, prazo e nonce. O pagamento vai direto para a tesouraria, em BNB ou num token. Com preço 0, o lote já foi pago no ledger do jogo e o contrato só registra a posse. A transferência é livre ([ADR-0014](../docs/adr/0014-decisoes-produto-mvp.md)) |
| [`AvatarNFT`](src/AvatarNFT.sol) | Smartcityano (ERC-721 com royalties EIP-2981, 2,5% para a tesouraria). Raridade (0 a 3) e profissão ficam gravadas no mint. A profissão é o código do catálogo em `bytes32` (ex.: `padeiro`), o mesmo do Strapi. Só quem tem o papel `MINTER` cria avatares |
| [`LuckyBox`](src/LuckyBox.sol) | Caixas por tier: moeda, preço e tabela de probabilidades por raridade, pública on-chain. `open` cobra e pede um número ao Chainlink VRF v2.5; o callback sorteia a raridade e a profissão e cria o avatar. A tabela vale como estava no momento da compra |
| [`BuildingNFT`](src/BuildingNFT.sol) | Prédio de construtor (doc 13 §7). Guarda o lote, o hash do GLB aprovado (`modelHash`), os andares e o construtor. O mint usa o voucher EIP-712 do world, dado só a prédio com alvará. O construtor precisa ser dono do lote no `LandNFT`, e cada lote tem no máximo um prédio vigente. `demolish` (dono do prédio e do lote) libera o lote |
| [`PropertyNFT`](src/PropertyNFT.sol) | Imóvel do catálogo (Casa T1 e os próximos) sobre um lote âncora (doc 07 §2.2). Guarda o lote, o tipo (`bytes32`, ex.: `t1`) e o nível; desgaste e renda ficam no world. O id do token é o id do imóvel no world (os 128 bits do UUID), então o mesmo imóvel não vira dois tokens. O mint usa o voucher do world, dado só a imóvel pronto, e exige que a carteira seja dona do lote no `LandNFT`; um imóvel por lote. `upgrade` leva o nível novo com outro voucher e só aceita nível maior. Depois do mint, a transferência é livre |
| [`SCityToken`](src/SCityToken.sol) | SCITY: ERC-20 com Permit e oferta fixa de 1 bilhão, criada uma única vez no deploy. Não tem função de mint |
| [`LocalVRFCoordinator`](src/dev/LocalVRFCoordinator.sol) | Coordenador VRF **só para o anvil e os testes**: qualquer um entrega o sorteio. Na BSC entra o coordenador real da Chainlink |

O VRF usa uma interface mínima ([`src/vrf/VRFV2Plus.sol`](src/vrf/VRFV2Plus.sol)), com os mesmos campos do `VRFV2PlusClient` oficial. O pacote da Chainlink não instala no Windows, porque os caminhos dos arquivos passam do limite de tamanho, e só esta parte é necessária.

**Provisório:**
- As probabilidades do tier de teste são 40/30/20/10%, as mesmas fatias do simulador. A tabela do whitepaper não está nas fontes (doc 02 §2).
- A Lucky Box depende do parecer jurídico (E0.8).

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
- sobe os sete contratos (o `BuildingNFT` e o `PropertyNFT` por último, para os outros endereços não mudarem);
- dá ao `LuckyBox` o papel de criar avatares;
- carrega as 44 profissões do seed do CMS (`cms-strapi/seed/profissoes.json`), separadas por raridade;
- cria o tier 1 (0,05 BNB);
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
