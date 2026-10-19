# Protótipo — Cidade realista e construtores

Demonstração da proposta do [doc 13](../13-cidade-realista-construtores.md), feita em Three.js r170 (carregado do jsDelivr) e sem build.

```bash
php -S localhost:8081 -t .
```

Rode na raiz do repositório e abra http://localhost:8081/docs/proposta-cidade-realista/index.html.

| Modo | O que mostra |
|------|--------------|
| **Explorar** | Cidade com ruas inclinadas, quadras irregulares, 206 lotes poligonais, parques, árvores, carros, sombras e sol pela hora do dia (controle na barra inferior) |
| **Mapa de lotes** | Situação de cada lote: seu, à venda pela Prefeitura, à venda por jogadores, ocupado, vazio, parque |
| **Construtor** | Lote do jogador → modelo (torre exemplo ou um `.glb`/`.gltf` real, inclusive com Draco ou meshopt) → validação (recuo, gabarito, coeficiente com outorga, polígonos, escala) → unidades (pé-direito, unidades por andar, térreo comercial, preço por m², VGV) → publicar → clicar num andar para ver e comprar as unidades |

No modo Construtor:
- **Megaempreendimento (superquadra):** remembra 4 quadras numa superquadra-marco (gabarito de 320 m), para prédios grandes como o do [estudo de caso do doc 13](../13-cidade-realista-construtores.md#13-estudo-de-caso-edifício-grande-edificioglb).
- **Vindo do SCC Builder:** o botão **Exportar para o mapa** do [SCC Builder](../../tools/scc-builder/README.md#exportar-para-o-mapa) abre esta página e entrega os três LODs já ajustados aos limites da plataforma; o modelo cai direto no seu lote, no modo Construtor. Só origens listadas em `BUILDER_ORIGINS` (no `main.js`) são aceitas.
- **Envio de LODs:** selecione os três arquivos `-lod0`, `-lod1` e `-lod2` gerados pelo [tools/scc-optimize](../../tools/scc-optimize/README.md) para montar um `THREE.LOD`. Arquivos acima de 40 MB (ou envio somando mais de 40 MB) são recusados. O orçamento de 300 mil triângulos é conferido no LOD0.

O clique num lote abre o painel com área, zona, gabarito, coeficiente e dono.

Limitações (é um protótipo): nada é salvo nem enviado à rede. A cidade é gerada por semente, e não a partir do OpenStreetMap. Mint, alvará e compras são simulados. `window.__scc` expõe funções para testes automatizados.
