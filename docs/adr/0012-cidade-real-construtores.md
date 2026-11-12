# ADR-0012 — Cidade real com lotes poligonais e prédios de construtores

- **Status:** Aceito (2026-11-12)
- **Data:** 2026-11-12
- **Trilhas afetadas:** client · backend · tools · contracts · econ
- **Substitui:** [ADR-0007](0007-cidade-real-nivel2.md)

## Contexto
A ADR-0007 previa o traçado do OpenStreetMap projetado numa grade de lotes quadrados. O [doc 13](../13-cidade-realista-construtores.md) propôs outra direção: a cidade no formato real, com lotes poligonais, e jogadores-construtores que sobem o próprio edifício (GLB) pelo SCC Builder e vendem as unidades no jogo. Essa direção já foi provada nas ferramentas:
- `tools/scc-builder/bin/city-import.js` converte uma cidade inteira (Pittsburg: 34,6 km, 100.152 lotes) e `bin/lib/lots.js` gera lotes de 16 pontos com zona, gabarito, recuo, coeficiente e preço.
- O simulador aprova o preço dos lotes com o estoque real ([ADR-0010](0010-criterio-economia-cobertura.md)).
- O mapa recebe o prédio do SCC Builder, confere gabarito, recuo e coeficiente e o põe no lote do jogador.

## Opções consideradas
1. Manter a ADR-0007: grade quadrada, prédios do catálogo. Simples para posse e preço, mas a cidade fica artificial e não há espaço para construtores.
2. Cidade real com lotes poligonais e prédios de construtores (doc 13). Mais trabalho de validação e moderação, mas é o diferencial do produto e já está prototipado.

## Decisão
Opção 2. O lote é um polígono em metros (GeoJSON) com área calculada, e a posse continua sendo do lote. Construtores sobem o edifício pelo SCC Builder, que valida contra as regras do lote; prédios públicos (como o Centro Administrativo) ocupam lotes da Prefeitura, fora da venda. A venda abre por bairro, do centro para fora (doc 03 §5).

## Consequências
- O serviço World guarda `lot.polygon` (jsonb) e as regras da zona; a grade deixa de ser a fonte da verdade.
- O cliente é o web nativo ([ADR-0009](0009-cliente-web-nativo.md)), que compartilha validação e LOD com o SCC Builder.
- Continuam abertos (doc 13 §11): cidade de referência definitiva (Pittsburg é cidade de teste; a licença do modelo usado não foi confirmada), unidades como ERC-721 ou ERC-1155, royalty, alvará e outorga, quem pode ser construtor, titularidade do código do Convert3D.
- Atribuição ODbL ("© OpenStreetMap contributors") obrigatória onde o traçado aparecer.
