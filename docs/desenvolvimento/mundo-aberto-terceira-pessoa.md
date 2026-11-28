# Mundo aberto em terceira pessoa: andar, comprar e consumir pela cidade

Análise de 2026-11-28. A pergunta foi: dá para o jogador andar pelas ruas, entrar nas lojas, comprar e consumir como num jogo de mundo aberto em terceira pessoa (a referência citada foi o GTA 6)? E quais arquivos 3D construir ou buscar em bibliotecas grátis?

**Resposta curta:** dá, no navegador, com o Three.js que já usamos ([ADR-0009](../adr/0009-cliente-web-nativo.md)). A imagem fica num "realista leve", e não no nível de um jogo de console. O que faz a experiência parecer de mundo aberto não é o polígono, é o conjunto: a câmera que segue o avatar, a cidade viva (gente e carros), entrar nas lojas sem tela de carregamento, o minimapa com destino e as ações com animação (pegar o produto, pagar, comer, dormir). Quase todas as regras do jogo já existem no servidor. Falta a camada de cliente e os arquivos 3D.

## 1. O que pegamos do gênero, e o que não pegamos

O GTA 6 é a referência de **gênero** (mundo aberto em terceira pessoa), não de conteúdo. O jogo não pode copiar nada que seja da Rockstar: nome, logotipo, mapa, personagens, missões, músicas, a arte da interface, o estilo dos ícones ou das telas de carregamento. Usamos as mecânicas comuns do gênero, que não têm dono, com arte e cidade nossas (Pittsburg do OpenStreetMap).

| Mecânica do gênero | No Smart Chain City | Já existe? |
|---|---|---|
| Câmera atrás do ombro, que segue e desvia de paredes | Câmera do street view com colisão contra os prédios | 🟡 a câmera segue, ainda não colide ([street view](street-view.md)) |
| Andar, correr, pular, virar com animação suave | WASD, Shift; faltam o pulo e as transições (virar, parar) | 🟡 andar e correr |
| Andar só por onde dá: rua, calçada, faixa, praça | Navmesh das calçadas e travessias, no lugar da "só rua" de hoje | ⬜ |
| Entrar na loja sem tela de carregamento | O interior carrega por streaming ao chegar perto da porta | 🟡 há o spike do escritório ([ADR-0015](../adr/0015-render-realista-e-biblioteca-3d.md)) |
| Comprar pegando o produto e passando no caixa | O carrinho do jogo chama as rotas que já existem | 🟡 a compra existe no painel; falta o "dentro da loja" |
| Comer, cozinhar, dormir com animação | Na casa ou no hotel, com os móveis da loja | 🟡 as regras existem; falta a cena |
| Cidade viva: pedestres e trânsito | Pedestres e carros controlados pelo cliente (não são jogadores) | ⬜ |
| Entrar no carro e dirigir | O carro da agência (E3.5) vira dirigível | ⬜ (o carro hoje só existe como regra de deslocamento) |
| Minimapa, GPS e destino | Minimapa do próprio mapa da cidade, com rota até a loja | ⬜ |
| Telefone do personagem | Atalhos para carteira, mercado, moradia e chat | ⬜ (os painéis existem) |
| Dia e noite, clima | Céu e luz pela hora do jogo; o HDRI troca | ⬜ |
| Violência, crime, polícia, armas | **Fora.** O jogo é de economia e vida na cidade (P2E com moeda real e público amplo); o doc 10 já trata o risco de conteúdo | — |

## 2. O que já existe e o que a camada nova usa

**No cliente** ([`docs/proposta-cidade-realista/`](../proposta-cidade-realista/README.md)):
- a cidade de Pittsburg do OSM, com ruas, lotes por bairro e prédios dos construtores (GLB do SCC Builder);
- o street view ([street-view.md](street-view.md)): o avatar da Universal Animation Library (Quaternius, CC0) anda e corre só sobre a camada de ruas, com câmera em terceira pessoa;
- o avatar Man/Woman (`avatar.js`) com clipes de idle, andar, correr, sentar e interagir, e o multiplayer por bairro (realtime).

**No servidor** (as regras que a cena só precisa chamar):

| Ação na cena | Rota que já existe | Regra que vale |
|---|---|---|
| Comer no balcão, no mercado | `POST /v1/avatars/:id/meals` | Fica "no mercado" 4 min + volume; 3% de dor de barriga |
| Encher o carrinho e pagar no caixa | `POST /v1/avatars/:id/pantry` | Limite da despensa pela casa (10, 30 ou 60 com geladeira) |
| Abrir a geladeira e comer | `POST /v1/avatars/:id/consume` | Sem cobrar de novo |
| Cozinhar no fogão ou no micro-ondas | `POST /v1/avatars/:id/cook` | Só com moradia e o eletrodoméstico |
| Deitar na cama | `POST /v1/avatars/:id/rest` | Descanso obrigatório após 16 h; casa completa dá +1 de felicidade |
| Banho, escovar os dentes | `POST /v1/avatars/:id/chores` | Uma vez a cada 4 h, em casa |
| Comprar na loja (roupa, móveis, skate) | `POST /v1/avatars/:id/shop` | Itens com efeito no turno e na casa |
| Fazer check-in no hotel | `POST /v1/avatars/:id/housing` | Hotel do jogo ou de jogador (90% ao dono) |
| Ir ao trabalho a pé, de skate, ônibus ou carro | `POST /v1/avatars/:id/work` com `commute` | O atraso e a tarifa do modo |
| Academia, galeria, parque | `POST /v1/avatars/:id/leisure` | Entrada paga ao dono do negócio |

**Ponto importante de design:** a regra continua no servidor ([ADR-0002](../adr/0002-servidor-autoritativo.md)). A cena só mostra e pede. Pegar o produto na prateleira enche um carrinho local, e o caixa faz a chamada. Se o servidor recusar (sem saldo, despensa cheia, ainda no mercado), a cena devolve o produto à prateleira com o aviso.

## 3. É possível no navegador? Orçamento e limites

| Item | Meta | Por quê |
|---|---|---|
| Quadros por segundo | 60 no notebook de referência; 30 no celular | O spike E0.9 deu 60/43; o do escritório, menos de 4 ms por quadro |
| Triângulos visíveis na rua | até ~1,5 milhão (LOD e instâncias) | Hoje: ruas 612 mil, planas e baratas |
| Avatar do jogador | 15 a 30 mil triângulos, 1 a 2 materiais, texturas de 1024 px | Esqueleto UAL, o mesmo das animações |
| Pedestre (NPC) | 3 a 8 mil triângulos, 1 material com atlas | Muitos ao mesmo tempo; o esqueleto é o mesmo |
| Carro | 10 a 25 mil (LOD0), 2 a 4 mil (LOD1), caixa (LOD2) | Trânsito com dezenas de carros |
| Interior de loja | ~150 mil triângulos, luz assada | O mesmo padrão do ADR-0015 |
| Peça de mobiliário urbano | 200 a 3 mil triângulos, instanciada | Postes, bancos, lixeiras se repetem milhares de vezes |
| Download inicial | até ~25 MB; o resto por streaming, por bairro | O lote já carrega por bairro hoje |

**Limites que aceitamos:**
- sem iluminação global em tempo real nem reflexo por raio; o realismo vem de luz assada, HDRI, PBR e pós-processamento (ADR-0015);
- a cidade de Pittsburg tem 100 mil lotes: prédios sem modelo de construtor ficam como volumes com fachada genérica, e o detalhe aparece perto do jogador (LOD e streaming);
- pedestres e carros são **do cliente**, iguais para todos só no comportamento, não na posição; os outros jogadores continuam vindo do realtime.

## 4. Bibliotecas técnicas (código, todas grátis e de licença aberta)

| Para quê | Biblioteca | Licença |
|---|---|---|
| Física: colisão do avatar e da câmera, carro dirigível | [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`) | Apache-2.0 |
| Navmesh das calçadas e dos interiores, rota de pedestres | [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) | MIT |
| Comportamento de pedestres e de trânsito (seguir caminho, desviar) | [Yuka](https://mugen87.github.io/yuka/) | MIT |
| Otimizar GLB: meshopt, KTX2, simplificar e gerar LOD | [glTF Transform](https://gltf-transform.dev) | MIT |
| Converter e ajustar modelos e animações | [Blender](https://www.blender.org) | GPL (os arquivos gerados são nossos) |

Antes de adotar, conferir a versão e a licença no próprio repositório (a lista foi montada em 2026-11-28).

## 5. Arquivos 3D: o que buscar e o que construir

Regra geral (ADR-0015): **o que vai à venda ou dentro de NFT precisa ser CC0 ou feito por nós com cessão de direitos.** CC-BY serve para cenário não vendido, com o crédito na tela de créditos. Licença "só uso pessoal", "editorial" ou sem licença clara não entra. Nada com marca real (logotipo de carro, de refrigerante, de loja famosa).

### 5.1 Onde buscar

| Biblioteca | O que tem de útil | Licença típica | Cuidado |
|---|---|---|---|
| [Quaternius](https://quaternius.com) | Personagens modulares, **UAL** (animações, já em uso), cidade, carros, comida | CC0 | Estilo low poly: bom para NPC e mobiliário, não para o avatar "realista" |
| [Kenney](https://kenney.nl/assets) | City Kit (ruas, prédios), Car Kit, Furniture Kit, Food Kit, sinalização | CC0 | Estilo cartoon; serve de protótipo e de blocos simples |
| [Poly Haven](https://polyhaven.com) | Modelos realistas de móveis e props, texturas PBR, **HDRI** de céu | CC0 | Alguns modelos são pesados: passar pelo SCC Builder |
| [ambientCG](https://ambientcg.com) | Texturas PBR: asfalto, calçada, concreto, tijolo, vidro | CC0 | Só textura (não tem malha) |
| [Poly Pizza](https://poly.pizza) | Muitos modelos leves de vários autores | CC0 ou CC-BY, por modelo | Conferir a licença de cada um |
| [Sketchfab](https://sketchfab.com/search?features=downloadable&licenses=7c23a1ba438d4306920229c12afcb5f9&licenses=322a749bcfa841b29dff1e8a1bb74b0b&type=models) | Carros genéricos, lojas, produtos, gente (filtro "Downloadable" + CC0/CC-BY) | Por modelo (CC0, CC-BY, CC-BY-NC…) | **NC (não comercial) não serve.** Muitos carros "grátis" copiam modelos reais: descartar |
| [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | Modelos de teste de material e câmera | Varia (muitos CC0/CC-BY) | Para testar o render, não para o jogo |
| [Mixamo](https://www.mixamo.com) | Animações de gente (pagar, carregar sacola, empurrar carrinho) | Uso livre em jogo, com conta Adobe | Os termos proíbem repassar os arquivos soltos; no navegador o GLB é extraível. **Pedir o parecer (E0.8) antes de usar**; preferir UAL ou animação própria |
| [Freesound](https://freesound.org) | Sons: passos, porta, caixa registradora, trânsito, ambiente | CC0 ou CC-BY, por som | Filtrar por licença |

### 5.2 O que buscar, por categoria

Prioridade: **P1** = para a fase 1 (andar e entrar na loja); **P2** = comprar e consumir; **P3** = cidade viva e carro.

**Avatar e animações**

| Arquivo | Prio | Buscar ou construir | Especificação |
|---|---|---|---|
| Avatar Man/Woman | ✅ | Já temos (UAL, CC0) | Manter o esqueleto UAL para todo humano do jogo |
| Roupas e cabelos trocáveis (camiseta, calça, tênis) | P2 | Construir sobre a malha UAL; base em Quaternius "modular characters" (CC0) | Peças com o mesmo esqueleto, 2 a 5 mil triângulos cada; liga com a loja de roupas |
| Clipes: virar no lugar, parar, pular, subir degrau | P1 | UAL (conferir o pacote), senão Blender | No mesmo esqueleto; em laço onde fizer sentido |
| Clipes: pegar da prateleira, pôr no carrinho, empurrar o carrinho, pagar no caixa, carregar sacola | P2 | Construir (Blender) ou UAL; Mixamo só depois do parecer | Ponto de mão (`hand_R`) para prender o objeto |
| Clipes: comer sentado, beber, cozinhar, deitar e dormir, banho (corte de câmera) | P2 | UAL + Blender | Ligados às rotas `consume`, `cook`, `rest` e `chores` |
| Clipes: entrar e sair do carro, dirigir, andar de skate | P3 | Construir | O skate liga com o item da loja (#115) |

**Rua e mobiliário urbano**

| Arquivo | Prio | Buscar | Especificação |
|---|---|---|---|
| Texturas de asfalto, calçada, faixa de pedestre, meio-fio | P1 | ambientCG, Poly Haven (CC0) | PBR em KTX2, 1024 a 2048 px, com repetição |
| Meio-fio e calçada em malha (peças modulares) | P1 | Construir (gerar do OSM, com a largura da via) | Gera também o navmesh da calçada |
| Postes de luz, semáforos, placas de rua, hidrantes, lixeiras, bancos, pontos de ônibus, caixas de correio | P1 | Kenney City Kit, Quaternius, Poly Haven (CC0) | 200 a 3 mil triângulos, instanciados, com colisor de caixa |
| Árvores e arbustos em 3 tamanhos | P1 | Poly Haven, Quaternius (CC0) | Com LOD; a copa vira impostor (sprite) de longe |
| Fachadas genéricas (térreo comercial, residencial, vitrines) | P2 | Construir, com texturas ambientCG | Para os prédios sem modelo de construtor |
| HDRI de céu (manhã, tarde, noite, nublado) | P1 | Poly Haven (CC0) | 2k para o reflexo; o céu visível em 4k |

**Lojas (o "comprar realista")**

| Arquivo | Prio | Buscar ou construir | Especificação |
|---|---|---|---|
| Interior do mercado: prateleiras, gôndolas, freezer, caixa, carrinho e cesta | P2 | Kenney Furniture/Food Kit como protótipo; versão final construída | ~150 mil triângulos, luz assada, porta de 0,9 × 2,1 m, navmesh |
| Produtos do mercado (um por alimento do catálogo: milho, maçã, ovos…) | P2 | Kenney Food Kit, Quaternius (CC0); embalagens próprias | Instanciados na prateleira; o código bate com o catálogo do game-core |
| Loja de roupas, de móveis, farmácia, pet shop, agência de carros | P2–P3 | Construir com blocos CC0 | O mesmo padrão; cada loja chama a rota que já existe |
| Restaurante ou lanchonete (comer no balcão) | P2 | Construir | Liga com `meals` |

**Casa e hotel (o "consumir realista")**

| Arquivo | Prio | Buscar | Especificação |
|---|---|---|---|
| Cama, sofá, mesa e cadeiras, guarda-roupa | P2 | Kenney Furniture Kit, Poly Haven (CC0) | São os itens da loja (#114): o que o avatar comprou aparece na casa |
| Fogão, geladeira, micro-ondas | P2 | Poly Haven, Kenney (CC0) | Pontos de interação para `cook` e `consume` |
| Banheiro: chuveiro, pia, vaso | P2 | Poly Haven, Kenney (CC0) | Interação para `chores` |
| Quarto de hotel (3 níveis de acabamento) | P3 | Construir | Liga com o hotel do jogo e o de jogador (#113) |

**Gente e trânsito (cidade viva)**

| Arquivo | Prio | Buscar | Especificação |
|---|---|---|---|
| Pedestres: 6 a 10 corpos com variação de roupa e cor | P3 | Quaternius (CC0) sobre o esqueleto UAL | 3 a 8 mil triângulos, atlas único, animação por instância |
| Carros genéricos (hatch, sedã, SUV, picape, táxi, ônibus) | P3 | Quaternius, Kenney (CC0); Sketchfab CC-BY **sem marca** | LOD0/1/2, rodas separadas, colisor de caixa |
| Sons: passos por piso, porta, caixa registradora, motor, buzina, ambiente de rua | P2–P3 | Freesound (CC0), feitos por nós | OGG, mono para efeitos e estéreo para o ambiente |

### 5.3 Pipeline de cada arquivo

1. **Baixar** só da página oficial da biblioteca, e guardar o link e a licença.
2. **Ajustar no Blender:** metros, Y para cima, origem no pé (gente) ou no centro da base (objeto), nomes sem espaço, esqueleto UAL para humanos.
3. **Exportar** glTF 2.0 binário (`.glb`), com PBR metal/rugosidade.
4. **Otimizar** pelo SCC Builder (preset `scc`) ou com glTF Transform: meshopt, KTX2, LOD0/1/2 e o colisor simplificado separado.
5. **Registrar** a origem num `licenca.json` ao lado do arquivo:
   ```json
   { "arquivo": "poste-luz-01.glb", "fonte": "https://…", "autor": "…", "licenca": "CC0-1.0", "baixado_em": "2026-11-28", "modificado": true, "vendavel": true }
   ```
   `vendavel: true` só para CC0 ou peça própria com cessão. O alvará e a loja recusam peça sem esse registro.
6. **Commitar** só o que é CC0 ou nosso. Modelos com licença que proíbe repasse ficam fora do repositório (como o Evermotion).

**Pastas sugeridas** (no SCC Kit, ADR-0015):

```
assets/kit/
  personagens/   avatar e roupas (esqueleto UAL)
  animacoes/     clipes extras no esqueleto UAL
  rua/           mobiliário urbano, árvores, peças de calçada
  lojas/         interiores e produtos
  casa/          móveis, eletrodomésticos, banheiro
  veiculos/      carros e ônibus
  materiais/     texturas PBR e HDRI
  sons/
```

## 6. Ordem sugerida

| Fase | Entrega | Arquivos | Código |
|---|---|---|---|
| **1. Andar pela cidade** | 🟡 Feito (2026-11-28, [street view](street-view.md#calçada-câmera-e-pulo-fase-1-do-mundo-aberto)): calçada caminhável com meio-fio, câmera que para antes do prédio e pulo. Falta: virada no lugar, faixas, postes e árvores, céu por hora | Texturas da rua, mobiliário P1, HDRI, clipes P1 | Rapier (câmera e avatar), navmesh das calçadas a partir do OSM, streaming por bairro |
| **2. Comprar e consumir** | Entrar no mercado sem carregamento; pegar, pôr no carrinho, pagar; em casa: geladeira, fogão, cama, banho | Interior do mercado, produtos, móveis e eletrodomésticos, clipes P2 | Pontos de interação ("E para pegar"), carrinho local → `pantry`/`meals`; casa → `consume`/`cook`/`rest`/`chores` |
| **3. Cidade viva** | Pedestres nas calçadas, trânsito nas ruas, ônibus no ponto | Pedestres, carros, sons | Yuka para os caminhos; densidade pelo FPS |
| **4. Carro e minimapa** | Entrar no próprio carro e dirigir; minimapa com GPS até a loja ou o trabalho | Carros com rodas, clipes P3 | Rapier (veículo); o deslocamento "carro" do turno passa a ter o trajeto |

Cada fase vira PRs pequenos, como até aqui, com teste no navegador. A fase 1 é a que mais muda a sensação de mundo aberto e a que menos depende de arte.

## 7. O que decidir antes

1. **Estilo visual:** "realista leve" (Poly Haven, texturas PBR) ou "estilizado" (Quaternius/Kenney). Misturar os dois na mesma cena fica estranho. Recomendação: realista leve para a cidade e os interiores, e o estilizado só como protótipo.
2. **Mixamo:** usar ou não depende do parecer jurídico (E0.8), porque o GLB no navegador é extraível.
3. **Quem modela:** a fase 2 pede um interior de mercado e um de casa feitos sob encomenda, com cessão de direitos (contrato do ADR-0015).
4. **Celular:** definir o aparelho de referência para a meta de 30 FPS, com a cidade viva ligada.
