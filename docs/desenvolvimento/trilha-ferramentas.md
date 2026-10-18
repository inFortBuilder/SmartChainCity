# Trilha — Ferramentas (simulador econômico e cidade real)

Pasta: [`tools/`](../../tools/README.md)

## A. Simulador econômico — `tools/econ-sim`

Especificação: [doc 04](../04-economia-tokenomics.md). É o **primeiro código a ser escrito**: valida a economia antes de qualquer contrato.

| Passo | O que fazer | Pronto quando |
|------:|-------------|---------------|
| 1 | Ler parâmetros de um JSON exportado do catálogo (preços, ganhos, multiplicadores, probabilidades) | Mesmo arquivo alimenta o Strapi (seed) |
| 2 | Modelar agentes: raridade, perfil (casual, estratégico, investidor), moradia, gastos diários | 100 mil agentes simulam 365 dias em < 1 min |
| 3 | Faucets e sinks do [doc 04 §7](../04-economia-tokenomics.md#7-faucets-e-sinks), câmbio e limites de saque | Ledger simulado fecha em 0 |
| 4 | Cenários de preço do SCITY (US$ 1,00 / 0,50 / 0,20) e de crescimento de jogadores | 3 × 3 cenários rodando |
| 5 | Relatório: payback por raridade, razão sinks/faucets, estoque de THALER per capita, pressão de venda de SCITY | HTML/CSV anexável ao PR |
| 6 | Critério de aprovação automático | Falha se payback sair de 40–78 dias ou se sinks/faucets < 0,9 |

## B. Pipeline de cidade real — `tools/osm-to-grid`

Especificação: [doc 03 §7](../03-cidade-lotes-imoveis.md#7-replicar-uma-cidade-real).

| Passo | O que fazer | Pronto quando |
|------:|-------------|---------------|
| 1 | Extrair um recorte do OpenStreetMap (Overpass ou arquivo `.pbf`) da cidade-referência | Arquivo de entrada versionado (ou script que o baixa) |
| 2 | Projetar em metros (UTM) e alinhar a origem com a Prefeitura (0,0) | Coordenadas em metros conferidas |
| 3 | Rasterizar em lotes de 10 m e classificar uso (`road`, `water`, `green`, `buildable`, `civic`) | Mapa de calor de uso conferido visualmente |
| 4 | Agrupar em células 6×6 e regiões 54×54; sortear os 20% mineráveis nas regiões A3 | JSON por célula válido contra `schema/cell.schema.json` |
| 5 | Exportar para o serviço World (seed de `lot`) e para o Unity (dados das células nos Addressables) | Região carregada no protótipo |
| 6 | Atribuição "© OpenStreetMap contributors" na tela de créditos (licença ODbL) | Créditos no jogo |
