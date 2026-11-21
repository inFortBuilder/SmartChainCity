# ADR-0015 — Render realista no Three.js e biblioteca 3D própria para venda no jogo

- **Status:** Proposto
- **Data:** 2026-11-21
- **Trilhas afetadas:** client · tools · metaverse · legal · econ

## Contexto
A cidade precisa de imagem mais realista. Também precisa de uma biblioteca de blocos (móveis, interiores, fachadas) que os construtores usam na modelagem e que o jogo vende aos jogadores. Os avatares futuros vão entrar nos ambientes, então os interiores precisam ser caminháveis. Foram avaliados dois pacotes:

| | Evermotion Archmodels Bundle vol. 1 | Relebook "Class Office" |
|---|---|---|
| Para que foi feito | Render offline de arquitetura (archviz) | Render offline de arquitetura (archviz) |
| Formatos e materiais | `.max` com V-Ray ou Corona; `.obj` e `.fbx` simples, sem os materiais | `.max` com V-Ray ou Corona (a página não mostrou o detalhe) |
| Malha e texturas | Alta densidade, texturas de 2k a 4k | Alta densidade, texturas grandes |
| Licença: render e vídeo | Permitido | Permitido (licença paga de um posto) |
| Licença: dentro de um jogo | Permitido só em formato proprietário, exibido durante o jogo, com crédito à Evermotion. É o texto antigo da página de licença; confirmar no EULA atual | Permitido só em formato criptografado ou proprietário, que impeça o jogador de extrair a malha |
| Licença: vender ou repassar o modelo | **Proibido** (EULA: revenda de modelos 3D) | **Proibido**, com ou sem modificação, inclusive "como pacote de material de design" |
| NFT | Não autorizado; o doc 13 §13 já registra o risco | Não tratado na licença: tratar como não autorizado |

Fontes: [licença Evermotion](https://evermotion.org/main/license), [EULA Evermotion](https://evermotion.org/shop/page/5/eula), [licença Relebook](https://www.relebook.com/serviceCenter/rulesDetail/8) e [termos Relebook](https://www.relebook.com/serviceCenter/rulesDetail/4), lidos em 2026-11-21. A página do produto da Evermotion bloqueia acesso automatizado, então os detalhes do bundle vêm de bundles e volumes parecidos e precisam ser conferidos antes da compra.

**Blocos grátis da Relebook (vistos em 2026-11-21).** A categoria Office tem 10 modelos a $0 "por tempo limitado". Dois foram abertos:

| Modelo | Polígonos | Arquivos | Render | Tamanho |
|---|---|---|---|---|
| [ggach660634](https://www.relebook.com/model-detail/ggach660634) (escritório com sofá e pendentes) | 13,1 milhões | MAX (3ds Max 2010) e SKP | V-Ray | 296 MB |
| [ggach605634](https://www.relebook.com/model-detail/ggach605634) (estações de trabalho) | 12,4 milhões | MAX (3ds Max 2010) e SKP | V-Ray | 363 MB |

Os outros 8 são cenas do mesmo tipo (escritório completo com luz e câmera). Os grátis usam a "Royalty Free License": uso comercial sem royalties, mas o modelo "não pode ser vendido, dado ou cedido" na forma em que foi baixado. A licença geral continua valendo: nada de revenda, mesmo modificada, e jogo só com malha protegida. Cada cena tem cerca de 40 vezes o orçamento de um prédio inteiro (300 mil triângulos), não tem FBX nem GLB e usa material de V-Ray. Para o jogo, seria refazer a cena do zero. Servem como referência visual de layout e para render de marketing, não para o SCC Kit.

Problemas para o nosso caso:

1. **Vender os blocos ao jogador é revenda.** As duas licenças proíbem isso. O mesmo vale para colocar o modelo num prédio que vira `BuildingNFT` ou `PropertyNFT` e é vendido.
2. **O cliente web entrega GLB ao navegador** ([ADR-0009](0009-cliente-web-nativo.md)). O GLB é um formato aberto, extraível pelo DevTools. Ofuscar o arquivo é uma proteção fraca, e não está claro que conte como o formato "proprietário/criptografado" que as licenças pedem.
3. **Material de V-Ray ou Corona não existe em tempo real.** Cada modelo precisa virar PBR glTF (base color, metal/rugosidade, normal, AO), com a malha reduzida e a luz assada. É trabalho manual por modelo, e o SCC Builder só automatiza a parte de malha e textura.
4. **Archviz não é caminhável.** Faltam colisor, navmesh, portas na escala do avatar e faces fechadas; o orçamento de 300 mil triângulos por prédio ([doc 13](../13-cidade-realista-construtores.md)) estoura com um único ambiente desses.

## Opções consideradas
**Motor de render**
1. **Manter o Three.js e subir a qualidade.** PBR com `MeshPhysicalMaterial`, iluminação assada (lightmaps feitos no Blender), HDRI de ambiente, sombras e reflexos de sonda, pós-processamento (AO, bloom, tone mapping AgX ou ACES) e o `WebGPURenderer` como caminho quando estável. Custo zero e o mesmo código do SCC Builder. É o que o spike E0.9 aprovou: 60 FPS no notebook e 43 FPS no celular.
2. **Unreal Engine 5 (Lumen, Nanite) por Pixel Streaming.** É a melhor imagem, mas cada jogador ocupa uma GPU no servidor. Isso contraria o MVP local sem custo e não escala para P2E.
3. **Unity HDRP.** Não roda em WebGL. O Unity URP WebGL já foi descartado no ADR-0009.
4. **Babylon.js.** A qualidade é parecida com a do Three.js, mas não compartilha código com o SCC Builder.

**Biblioteca 3D**
1. Comprar Evermotion ou Relebook e vender os blocos no jogo: **proibido** pelas licenças.
2. Comprar e usar só na cena oficial do jogo, sem vender: depende de confirmação por escrito dos dois fornecedores, por causa do GLB extraível (problema 2), e ainda exige a conversão manual (problema 3).
3. **Biblioteca própria "SCC Kit".** A base vem de acervo CC0 (Poly Haven, ambientCG, Kenney, Quaternius), que pode ser vendido e virar NFT. Peças sob encomenda feitas por modeladores, com contrato de cessão dos direitos patrimoniais ao projeto. Tudo já no padrão de tempo real e de avatar.

## Decisão
**Render:** manter o Three.js (ADR-0009) e buscar o realismo com luz assada, PBR, HDRI e pós-processamento, migrando para o `WebGPURenderer` quando estável. Unreal por Pixel Streaming fica, no máximo, para tours de marketing, nunca para o jogo.

**Biblioteca:** não usar Evermotion nem Relebook como blocos vendidos no jogo nem dentro de NFTs. O catálogo vendável é o **SCC Kit** próprio (CC0 mais peças encomendadas com cessão de direitos). Esses pacotes podem ser comprados só para render de marketing e referência visual, e só entram no jogo, como cenário não vendido, se o fornecedor confirmar por escrito o uso em cliente web com GLB.

## Consequências
- **Padrão SCC Kit** (preset `scc` do SCC Builder): glTF 2.0 com metros, Y para cima e PBR metal/rugosidade; KTX2 de até 2048 px; meshopt; LOD0/1/2; colisor simplificado separado; lightmap no UV2; no máximo 8 materiais por peça. Peça de mobília com cerca de 5 a 20 mil triângulos no LOD0; ambiente interior com cerca de 150 mil triângulos visíveis.
- **Interiores caminháveis:** portas de pelo menos 0,9 × 2,1 m, pé-direito de pelo menos 2,6 m, faces fechadas, colisor por cômodo, navmesh gerada (Recast) e streaming do interior só ao entrar no prédio.
- **Avatar:** humanoide glTF ou VRM, com o esqueleto padrão e as animações de andar, sentar e trabalhar compartilhadas, na mesma escala do kit (1,7 a 1,8 m).
- **Contrato de encomenda:** cessão total dos direitos patrimoniais, permissão de venda, de NFT e de modificação, e garantia de que a peça não usa material de terceiros.
- **Moderação do alvará:** o SCC Builder procura nomes de bibliotecas comerciais conhecidas (por exemplo `archmodels`, `Archexterior`) e o construtor declara a origem dos modelos ao enviar.
- **Spike do escritório (2026-11-21):** feito ([resultado](../desenvolvimento/spike-escritorio-adr0015.md)). Interior com luz assada, AO e o avatar entrando pela porta em menos de 4 ms por quadro numa GTX 1660, com cerca de 30 mil triângulos. O lightmap passa a vir do Blender junto com o interior, em vez de ser assado no navegador. Falta medir no notebook de referência e no celular (meta de 60 e 30 FPS).
- **Pendente:** o parecer jurídico (E0.8) confirma a leitura das licenças antes de qualquer compra.
