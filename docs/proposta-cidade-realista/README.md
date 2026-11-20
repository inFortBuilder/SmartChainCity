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

**Cidade real:** [pittsburg.html](pittsburg.html) mostra Pittsburg, Califórnia, a partir de um OBJ do OpenStreetMap: camadas, sol, clique com a ficha de cada prédio e camada **Lotes**, com 100 mil lotes poligonais, zona, regras e preço. Gerada com `--sem-predios`, a cidade aparece só com o traçado e todos os terrenos à venda, abertos um bairro por vez: verde é o bairro aberto, cinza os que ainda vão abrir. O modelo não fica no repositório; gere antes com [`bin/city-import.js`](../../tools/scc-builder/README.md#cidade-inteira-em-obj). Os lotes ainda não estão no banco.

**Gestão (Pittsburg):** a barra superior vira o HUD do jogador (avatar Comum · Padeiro, bairro onde a câmera está, saldos de SCITY e THALER, velocidade do tempo). Clique num lote verde e compre-o em SCITY. No seu lote (ciano), a ficha lista os negócios que a zona permite, com custo em THALER, obra, lucro por dia e retorno. Os bloqueados mostram o motivo, por exemplo a farmácia, que exige avatar enfermeiro (GDD). A obra sobe como um bloco cinza e, pronta, ganha a cor do negócio. O lucro acumula até 7 dias e é recolhido com **Coletar**. **Meu patrimônio** lista lotes e negócios, com **Coletar tudo** e **Ir até**. O catálogo e as regras ficam em [negocios.js](negocios.js); a tela e o 3D, em [gestao.js](gestao.js).

**Jogo no servidor (célula jogável, E1.6):** o painel no canto inferior esquerdo liga o mapa aos serviços, sem nada simulado. Você entra com a carteira (SIWE, pelo [gateway](../../services/gateway/README.md)), vê o avatar e os atributos ([game-core](../../services/game-core/README.md)), trabalha um turno de 6 ou 12 h, que o servidor conclui mesmo com a página fechada, e coleta o THALER no [ledger](../../services/economy/README.md). Sem MetaMask, em `localhost`, dá para entrar com uma **carteira de teste** gerada no navegador. Também dá para entrar **com o e-mail**: o gateway manda um código de 6 dígitos, que na máquina local aparece no log do gateway. Com login, a ficha do lote consulta o [world](../../services/world/README.md): situação real, preço em SCITY e **Comprar**, que cobra no ledger; os seus lotes no servidor ficam violeta. Os negócios (barra superior e "Meu patrimônio") continuam simulados, marcados como "simulado".

Para subir tudo na sua máquina:

```bash
pnpm db:up
pnpm db:migrate
pnpm --filter @scc/gateway dev
pnpm --filter @scc/economy dev
pnpm --filter @scc/game-core dev
pnpm --filter @scc/world import:city ../../.local/cidades/pittsburg --code pittsburg
pnpm --filter @scc/world dev
pnpm dev:fund-pool
```

Antes, copie o `.env.example` de cada serviço para `.env` e preencha os segredos. O `JWT_SECRET` é o mesmo nos três. No gateway, `SIWE_DOMAINS` e `CORS_ORIGINS` precisam incluir `localhost:8081`. No game-core, `ECONOMY_TOKEN` é o `INTERNAL_TOKEN` do economy; para testar, `DEV_FREE_AVATAR=true` dá um avatar de teste e `DEV_SHIFT_MINUTES=1` faz o turno durar 1 minuto (pagando como 6 h). No economy, `DEV_FAUCET=true` liga o botão “+1.000 SCITY de teste” (no jogo, SCITY só entra por depósito da blockchain). Os endereços dos serviços podem ser trocados na URL: `?gateway=`, `?economy=`, `?game=`, `?world=`.

**Carregamento por bairro ([spike E0.9](../desenvolvimento/spike-e0.9-cliente-web.md)):** os lotes chegam um bairro por vez, primeiro os abertos e depois os perto da câmera; antes, gere os blocos com [`bin/city-chunks.js`](../../tools/scc-builder/README.md#lotes-por-bairro). Prédios usam LOD progressivo: o mais leve chega primeiro e os detalhados só de perto. Com `?spike` na URL, o mapa põe 20 prédios de teste e mostra download, FPS e tempo de quadro num painel (o código está em [spike.js](spike.js)).

**Centro Administrativo:** se a pasta da cidade tiver `civico.json` (gerado pelo [`bin/city-civic.js`](../../tools/scc-builder/README.md#centro-administrativo)), o mapa põe o prédio público no centro, com os três LODs, pinta de amarelo os lotes dele e os tira da venda. O botão **Ir ao Centro Administrativo**, no painel de camadas, leva até lá; a ficha desses lotes mostra a Prefeitura em vez do preço.

**Seu prédio do SCC Builder em Pittsburg:** o botão **Exportar para o mapa** do [SCC Builder](../../tools/scc-builder/README.md#exportar-para-o-mapa) abre este mapa e entrega os LODs da casa ou do prédio. O mapa leva o modelo ao seu lote: o que está aberto na ficha ou, se você só tem um, a ele. Com vários, use **Ir até** no painel. A ficha confere gabarito, recuo e coeficiente ([encaixe.js](encaixe.js)), alinha o prédio ao lado mais comprido do lote (ou o gira 90° se só assim couber) e mostra o motivo quando não cabe. Ao confirmar, o prédio entra no lugar do que houver no lote: o bloco padrão do negócio ou outro prédio seu. O negócio continua; em obra, o prédio sobe junto. **Tirar e voltar ao bloco padrão** desfaz. Os arquivos ficam no IndexedDB do navegador e voltam ao recarregar; o ↺ apaga. Para testar sem comprar, o padeiro já começa com um **terreno de teste** grátis: o maior lote de uso misto do bairro aberto entre 1.500 e 5.000 m² (gabarito de 60 m), marcado como "teste" no painel e dado de novo após o ↺.

- Custo, obra, receita e despesa dos negócios são **premissas deste protótipo**, sem fonte nos documentos: foram escolhidas para o retorno ficar entre 53 e 67 dias (a Casa T1, moradia, leva 286).
- Negócio vende a NPCs, então é uma **fonte de THALER que o [simulador econômico](../../tools/econ-sim/README.md) ainda não modela**. Antes de virar regra, precisa entrar no simulador.
- Tudo fica no `localStorage` deste navegador; o botão ↺ apaga. No jogo, saldo e posse são decididos pelo servidor (ADR-0002).

No modo Construtor:
- **Megaempreendimento (superquadra):** remembra 4 quadras numa superquadra-marco (gabarito de 320 m), para prédios grandes como o do [estudo de caso do doc 13](../13-cidade-realista-construtores.md#13-estudo-de-caso-edifício-grande-edificioglb).
- **Vindo do SCC Builder:** o botão **Exportar para o mapa** do [SCC Builder](../../tools/scc-builder/README.md#exportar-para-o-mapa) abre esta página e entrega os três LODs já ajustados aos limites da plataforma; o modelo cai direto no seu lote, no modo Construtor. Só origens listadas em `BUILDER_ORIGINS` (no `main.js`) são aceitas.
- **Envio de LODs:** selecione os três arquivos `-lod0`, `-lod1` e `-lod2` gerados pelo [tools/scc-optimize](../../tools/scc-optimize/README.md) para montar um `THREE.LOD`. Arquivos acima de 40 MB (ou envio somando mais de 40 MB) são recusados. O orçamento de 300 mil triângulos é conferido no LOD0.

O clique num lote abre o painel com área, zona, gabarito, coeficiente e dono.

Limitações (é um protótipo): nada é salvo nem enviado à rede. A cidade é gerada por semente, e não a partir do OpenStreetMap. Mint, alvará e compras são simulados. `window.__scc` expõe funções para testes automatizados.
