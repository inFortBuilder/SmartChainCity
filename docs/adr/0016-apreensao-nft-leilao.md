# ADR-0016 — Apreensão do NFT no leilão por imposto

- **Status:** Proposto
- **Data:** 2026-11-21
- **Trilhas afetadas:** contracts · backend · legal

## Contexto
O lote com imposto atrasado há mais de 120 dias vai a leilão ([doc 03 §4](../03-cidade-lotes-imoveis.md), world E2.6), e o imóvel vai com ele. Dentro do jogo, o leilão já passa o lote ao vencedor. Mas o `LandNFT` e o `PropertyNFT` circulam livres ([ADR-0014](0014-decisoes-produto-mvp.md)), então criavam dois problemas:

1. O NFT ficava na carteira do antigo dono, e o vencedor pagava sem receber o token.
2. Com a posse on-chain seguida pelo jogo (`chain.sync`), o antigo dono podia vender o NFT na blockchain e levar o lote de volta no jogo para outra conta. Se vendesse **durante** o leilão, a passagem do lote não acontecia, porque ela conferia o dono antigo, e o vencedor pagava e ficava sem o lote.

## Opções consideradas
1. **Deixar como está.** O imposto não teria força sobre quem leva o lote para a carteira. Descartado.
2. **Travar a transferência do token inadimplente.** Exige que o world mande transações para marcar e desmarcar cada token (gás e chave quente) e ainda não leva o token ao vencedor.
3. **Apreensão por voucher do world.** É o mesmo padrão da cotação e dos vouchers de imóvel: o world assina, e o contrato confere e transfere de quem tiver o token.
4. **Só pelo `Marketplace` (E3.6).** O contrato ainda não existe, e o token pode estar fora dele.

## Decisão
**Opção 3.** `LandNFT.seize` e `PropertyNFT.seize` recebem `Seizure{tokenId, to, nonce, deadline}` assinado pelo papel `SIGNER` (a chave do world) e passam o token **de quem o tiver** para `to`, sem a aprovação do dono, com o evento `Seized`. Os limites do poder:

- só com assinatura do `SIGNER`, nonce de uso único (separado das cotações) e prazo;
- o token só vai para o `to` assinado; qualquer um pode enviar a transação (o vencedor paga o gás);
- a pausa do contrato também para a apreensão;
- o world só assina para o vencedor de um leilão fechado e para uma carteira ligada à conta dele.

No jogo:

- O leilão entrega o lote e o imóvel a quem os tiver na hora do fechamento. A dívida acompanha o lote, então vender na blockchain durante o leilão não o salva.
- Se o token pode estar numa carteira, o leilão abre a apreensão. O vencedor pede o voucher (`POST /v1/world/seizures/:id/voucher`). Token que nunca foi para a blockchain cancela a apreensão, e o vencedor usa o caminho normal.
- Enquanto a apreensão está aberta, o `chain.sync` ignora as transferências do token e a fecha quando o token chega ao vencedor.

## Consequências
- **Quem compra um lote ou um imóvel na blockchain herda o risco do imposto.** A rota pública do leilão mostra os lotes em leilão. O `Marketplace` (E3.6) e os metadados do token devem avisar quando o lote está inadimplente ou com apreensão aberta.
- **O papel `SIGNER` ganha um poder a mais.** A chave vai para o KMS na testnet e na mainnet (doc 07 §3), e a auditoria (E3.8) deve cobrir o `seize`. O parecer jurídico (E0.8) precisa confirmar que os termos de uso descrevem a apreensão por imposto.
- **Prédios de construtor (`BuildingNFT`) não vão a leilão**, como hoje, e não ganham `seize`.
- **Os endereços do deploy local não mudam**: o bytecode muda, mas a ordem do deploy é a mesma.
