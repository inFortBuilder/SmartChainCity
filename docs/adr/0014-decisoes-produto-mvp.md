# ADR-0014 — Decisões de produto do MVP

- **Status:** Aceito (2026-11-12)
- **Data:** 2026-11-12
- **Trilhas afetadas:** backend · contracts · client · econ · legal

## Contexto
Quatro decisões de produto do [doc 11 §3](../11-decisoes-pendentes.md#3-decisões-de-produto--técnica) não tinham ADR e travavam o desenho de contratos, economia e cliente: a regra de bairro no mercado secundário, a moeda da Lucky Box, o período grátis e o avatar 3D.

## Opções consideradas
1. Regra de bairro: (a) restrição no contrato · (b) só no jogo.
2. Moeda da Lucky Box: SCITY · BNB · stablecoin.
3. Período grátis (scholarship): sim · não.
4. Avatar no jogo principal: só 2D · 3D modular.

## Decisão
- **Regra de bairro:** vale só no jogo (b). O contrato não restringe a transferência, o que mantém compatibilidade com marketplaces externos.
- **Lucky Box:** paga em stablecoin ou BNB no lançamento, para o preço ficar estável; SCITY passa a ser aceito depois do TGE. Depende do parecer jurídico (E0.8).
- **Período grátis:** sim, com ganhos não conversíveis em SCITY.
- **Avatar:** 2D no MVP de gestão; 3D no modo passeio, numa fase seguinte.

## Consequências
- Os contratos de terreno e imóvel ficam com transferência livre; a regra de bairro é checada pelo servidor ao usar o lote.
- O cofre (GameVault) precisa marcar saldo vindo do período grátis como não sacável.
- Se o parecer jurídico vetar a venda de boxes por cripto, a Lucky Box passa a ser vendida em moeda fiduciária ou fica desativada por região (risco já no ROADMAP).
