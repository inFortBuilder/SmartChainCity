# Street view: caminhar pelas ruas da cidade

Na cidade real (`docs/proposta-cidade-realista/pittsburg.html`), o jogador arrasta o boneco do canto inferior direito até uma rua, como no Street View do Google. Durante o arrasto, as ruas ficam azuis e o marcador no chão fica verde sobre a rua e vermelho fora dela. Ao soltar numa rua, a câmera desce ao nível do chão, atrás do avatar, e ele caminha **só pelas ruas**.

| Comando | O que faz |
|---|---|
| W A S D ou setas | Anda; para a frente é para onde a câmera olha. Parado e mandado para trás ou para o lado (mais de 100°), o avatar gira no lugar (~400°/s) antes de sair andando |
| Shift | Corre |
| Espaço | Pula (clipes `Jump_Start`, `Jump_Loop` e `Jump_Land` da UAL) |
| Clique ou toque na rua | Caminha até o ponto contornando gôndolas, ilhas e paredes ([caminho](#caminho-em-volta-dos-obstáculos-fase-2)); sem caminho, vai em linha reta e para na borda |
| Arrastar | Gira a câmera em volta do avatar |
| Roda do mouse | Aproxima ou afasta a câmera (2 a 14 m) |
| Esc ou "← Voltar ao mapa" | Volta à visão de mapa, no ponto onde estava |

## Colisão: só a rua é chão

A área de caminhada é a própria camada `roads` da cidade: os polígonos das ruas do OpenStreetMap que o `city-import.js` converteu. São 612 mil triângulos planos, num único mesh.

- `buildRoadIndex` põe os triângulos numa grade de 32 m, em formato compacto (CSR). Na primeira vez que o boneco é arrastado, ela é montada em cerca de 135 ms. Depois disso, responder se um ponto é rua custa cerca de 0,5 µs.
- A cada quadro, o passo do avatar só acontece se o destino é rua. Se não for, ele tenta deslizar só no eixo X ou só no Z, para acompanhar a calçada sem travar. Se nenhum dos dois for rua, ele para e volta ao idle.
- Ao entrar, o avatar já olha para a rua mais longa a partir do ponto, testada em 16 direções.
- Os prédios não precisam de colisão própria: eles não ficam sobre a rua.

**Testado** em 2026-11-21 no navegador, com a cidade de Pittsburg:
- arrastar e soltar numa rua entra no street view, e fora dela aparece o aviso;
- 4 s andando ficaram sempre sobre a rua, com 6,3 m percorridos;
- correndo contra a borda, o avatar parou nela, sem sair da rua;
- o boneco não encobre os painéis no celular (375 px).

## Calçada, câmera e pulo (fase 1 do mundo aberto)

Parte da fase 1 do [mundo aberto em terceira pessoa](mundo-aberto-terceira-pessoa.md):

- **Calçada:** em volta do avatar, uma grade de 0,5 m num raio de 40 m marca a faixa de 3 m ao lado das ruas. A grade é refeita a cada 20 m andados, em cerca de 14 ms. A distância até a rua sai de uma transformada de distância em duas passadas (chamfer 1/√2), sem testar vizinho a vizinho. A faixa fica 15 cm acima do asfalto (o meio-fio), e o avatar sobe e desce dela sem degrau seco. Dá para andar e clicar nela. É desenhada em concreto claro, numa malha só: o contorno sai de marching squares sobre a grade (a borda corta em diagonal, sem degraus de 0,5 m), e uma face vertical de 15 cm fecha o meio-fio ao longo da borda (`sidewalkMesh`). Com a malha, a grade passou a ser montada em ~23 ms (cerca de 4.500 triângulos).
- **Prédios:** os prédios com LOD (o Centro Administrativo) e os da gestão entram como caixas orientadas, no espaço do próprio prédio. A caixa alinhada aos eixos de um prédio girado cobria as ruas em volta: no Centro Administrativo, tirava cerca de 230 peças de calçada. O chão dentro do prédio fica fora da calçada.
- **Câmera:** para 30 cm antes do primeiro prédio entre a cabeça do avatar e ela. Testado com uma parede de 12 m a 6 m atrás do avatar: a câmera parou a 5,2 m, em vez dos 14 m pedidos.
- **Virada no lugar:** testada com S a partir do idle: girou 160° em 350 ms sem sair do lugar, e depois saiu andando. A UAL não tem clipe de virada, então os pés usam o de andar a 70% da velocidade.
- **Pulo:** sobe 0,94 m (4,2 m/s, gravidade de 9,8 m/s²) e pousa de volta no meio-fio ou na rua.
- **Premissas:** calçada de 3 m em toda rua e meio-fio de 15 cm, porque o OSM quase nunca desenha a calçada.

**Testado** em 2026-11-28 no navegador, perto do Centro Administrativo de Pittsburg:
- a grade de calçada foi montada em 14 ms, com 1.419 peças;
- o clique na calçada levou o avatar até ela, a 15 cm de altura;
- o pulo chegou a 0,94 m e pousou no meio-fio;
- a câmera parou antes da parede de teste.

## Postes, árvores e céu pela hora

- **Mobiliário** (`mobiliario.js`):
  - postes de luz no meio-fio, um a cada ~24 m, com o braço para a rua; árvores no lado de dentro da calçada, a cada ~11 m;
  - a posição sai de um sorteio fixo pela posição no mundo, e refazer a grade não tira nada do lugar;
  - são 5 malhas procedurais instanciadas, sem arquivo externo; um GLB CC0 entra no lugar quando o SCC Kit tiver a peça;
  - poste e árvore ocupam a célula da calçada, e o avatar contorna.
- **Céu** (`ceu.js`):
  - no street view, o sol, o céu, a exposição e a neblina seguem a hora de Brasília (o mesmo fuso da agenda do realtime); `?hora=HH` força uma hora para testar;
  - o sol nasce às 6 h e se põe às 18 h e sobe a 70° ao meio-dia, com luz quente quando está baixo;
  - à noite, as luminárias dos postes acendem (emissivas, sem luz real por poste, para caber no orçamento);
  - na visão de mapa, volta o céu fixo de sempre.
- **Premissas:** os espaçamentos, as alturas (poste de 6 m, árvore de ~4,5 m) e o nascer e o pôr do sol fixos, sem estação do ano.

**Testado** em 2026-11-28 perto do Centro Administrativo:
- ao meio-dia, 5 postes e 14 árvores em volta do avatar;
- às 21 h, céu escuro e luminárias acesas;
- às 17h30, o sol a 9° e a luz mais quente;
- o avatar mandado contra um poste contornou a célula;
- ao voltar ao mapa, a exposição voltou a 0,85.

## Faixas de pedestre nos cruzamentos

O OSM de Pittsburg quase não desenha as faixas, então `faixas.js` as tira da grade da calçada:

1. De um ponto do meio-fio, atravessa a rua. Se chega à calçada do outro lado em 4 a 20 m, é um trecho de rua.
2. Do meio desse trecho, anda ao longo da rua. Onde a largura salta 1,7 vez, começa o cruzamento.
3. A faixa vai 3 m antes desse ponto, de meio-fio a meio-fio, com listras de 0,5 m a cada 1 m.

- **Filtros:**
  - a borda da grade só conta como rua que segue depois de 20 m de rua (sem isso, saíam faixas falsas nos cantos da grade);
  - a faixa precisa de 8 m de rua da mesma largura atrás dela (sem isso, saía uma "faixa" em diagonal, de esquina a esquina, no meio do cruzamento);
  - a mesma chegada não repete: uma faixa a menos de 6 m e no mesmo rumo é a mesma.
- **Desenho:** são listras brancas instanciadas, rente ao asfalto. A rua inteira continua caminhável, e os carros e pedestres da fase 3 podem usar as mesmas posições.
- **Premissas:** a faixa de 3 m, as listras e o salto de 1,7 vez.

**Testado** em 2026-11-28:
- fora do navegador, a mesma função deu 4 faixas no cruzamento em +, 3 no T, nenhuma na rua reta, 4 no X em 45° e 4 nas ruas de 12 m, todas na posição esperada;
- em Pittsburg, 34 pontos em volta do Centro Administrativo deram faixas em 8, onde há cruzamento a menos de 40 m;
- no cruzamento de (-1397, 4857), as 3 chegadas tiveram cada uma a sua faixa, depois de tirar as repetidas (antes eram 6);
- a grade completa (calçada, postes, árvores e faixas) é montada em cerca de 29 ms.

## Mercado da Prefeitura na rua (fase 2)

O primeiro lugar da fase 2 do [mundo aberto](mundo-aberto-terceira-pessoa.md) (comprar e consumir). O Mercado da Prefeitura (`mercado-rua.js`) fica num lote ao lado da calçada, perto do cruzamento de (-1397, 4857), em Pittsburg.

- **Entrar:** pela porta, sem tela de carregamento. Dentro, o chão fica na altura do meio-fio. Paredes e telhado seguram a câmera, e uma luz acende o salão.
- **Dentro:** 4 gôndolas com os alimentos do catálogo do game-core (a cor sai do grupo), o caixa à direita da porta e o balcão de lanches à esquerda.
- **Comprar:**
  - na gôndola, **E** põe o pacote no carrinho, que fica no canto da tela com o total;
  - no caixa, **E** paga, e cada pacote vai para a despensa pela rota do painel (`POST /v1/avatars/:id/pantry`);
  - no balcão, **E** come na hora (`POST /v1/avatars/:id/meals`), e **Q** troca o alimento;
  - o aviso também tem um botão, para o celular.
- **Regras:** as do servidor. Se a compra para (despensa cheia, sem saldo), o carrinho fica com o que faltou e mostra o motivo.
- **No game-core:** no mercado, dá para comprar de novo, porque cada compra soma o tempo dela ao que falta. Antes, a 2ª compra dava `at_market` e impedia o carrinho. O turno e o lazer continuam travados enquanto o avatar está no mercado.
- **Peças:** procedurais, como o mobiliário da rua. O interior do SCC Kit ([ADR-0015](../adr/0015-render-realista-e-biblioteca-3d.md)) entra depois.
- **Premissas:** o lugar, o tamanho (14 × 12 m) e a arrumação.

**Testado** em 2026-11-28 com a conta de teste:
- o avatar foi da rua até a porta e entrou;
- pegou Ovos e Leite em duas vagas da gôndola;
- no caixa, os Ovos foram para a despensa (de 5 para 8 unidades);
- o Leite foi recusado: sem moradia, cabem 10, e seriam 11. O carrinho ficou com o Leite e o aviso "A despensa está cheia".

O teste também pegou uma fresta entre a rua e a calçada, onde o avatar empacava. A célula de rua da grade passou a valer como chão.

## Loja do jogo e farmácia na rua (fase 2)

Perto do mercado, no mesmo cruzamento, ficam mais duas lojas (`lojas-rua.js`), com a mesma casca do mercado (`storeShell`: paredes com a porta, telhado que segura a câmera, letreiro e luz):

- **Loja do jogo:** expositores com os itens de `/v1/catalog/shop`, comprados por `POST /v1/avatars/:id/shop`:
  - roupas 1 a 3 na parede da esquerda;
  - fogão, geladeira e micro-ondas na da direita;
  - sofá, mesa e guarda-roupa no fundo;
  - ferramenta de trabalho, cama e skate na ilha do meio.
- **Farmácia:** o balcão vende o remédio da doença em curso (`POST /v1/avatars/:id/medicine`). Sem doença, avisa e não cobra.
- **Confirmação:** compra é dinheiro. O 1º **E** mostra o preço e pede confirmação; o 2º **E** (em 4 s) compra. O aviso também tem um botão.
- **Regras:** as do servidor (saldo, item que o avatar já tem, doença grave só no hospital).

**Testado** em 2026-11-28:
- na loja, o 1º E armou a compra ("Confirmar: Skate · 120,00 THALER"), e o servidor recusou o skate, que a conta já tinha;
- o micro-ondas saiu por 150,00 THALER, e o avatar passou a cozinhar no micro-ondas;
- na farmácia, sem doença: "O avatar não está doente.";
- o mercado seguiu com os 17 alimentos e as 24 vagas.

## Caminho em volta dos obstáculos (fase 2)

O clique para andar ia em linha reta e parava na primeira gôndola, na ilha da loja ou na parede. `caminho.js` acha o caminho:

1. Se a linha reta está livre, vai direto.
2. Senão, faz um A* numa grade de 0,4 m em volta da origem e do destino (12 m de margem), com 8 vizinhos, sobre o chão andável (rua, calçada, salão das lojas e do mercado). Cada nó precisa de 0,25 m de folga, e a diagonal não corta quina.
3. O caminho é alisado por linha de visada: de cada ponto, pula para o mais longe que se vê em linha reta.

O avatar segue os pontos. O teclado cancela o caminho. Sem caminho (destino cercado), cai na linha reta de antes. A API do street view ganha `walkTo(x, z)`, o mesmo do clique.

**PREMISSAS:** grade de 0,4 m, folga de 0,25 m, margem de 12 m e no máximo 60 mil nós.

**Testado** em 2026-11-28:
- na loja, da rua até o micro-ondas, atrás da ilha, num comando só: 3 pontos, calculado em 3 ms, chegou a 0,28 m e armou o micro-ondas;
- no mercado, da rua até a vaga de um corredor do canto, atravessando as gôndolas: 5 pontos, 6 ms, chegou a 0,27 m na prateleira do milho;
- no Node: em volta de uma ilha (4 pontos, 9,25 m, 5 ms), linha reta (1 ponto), destino cercado (sem caminho) e entre gôndolas (6 pontos, todos andáveis).

## Consumir em casa (fase 2)

Na residência do próprio jogador (`escritorio.html?tipo=home&dono=1`; o mapa manda `dono=1` quando a visita não é de convidado), `casa-jogo.js` liga as peças às rotas do game-core:

| Peça | Ação (E) | Rota |
|---|---|---|
| Geladeira (nova, na ponta da bancada) | Comer da despensa | `POST /v1/avatars/:id/consume` |
| Fogão (a cozinha) | Cozinhar da despensa, com fogão ou micro-ondas | `POST /v1/avatars/:id/cook` |
| Cama | Dormir 8 h ou cochilar 4 h | `POST /v1/avatars/:id/rest` |
| Banheiro (novo, no canto do fundo) | Banho, escovar os dentes, lavar as mãos | `POST /v1/avatars/:id/chores` |

- O alimento é o que há mais na despensa.
- O aviso mostra o resultado ou o motivo do servidor (sem moradia, despensa vazia, satisfeito, dormindo, intervalo da higiene).
- O convidado continua com a casa de enfeite: ele não come da despensa de ninguém.
- A página usa a mesma sessão do mapa (`sessionStorage`).

**Testado** em 2026-11-28 com a conta de teste, que não tem moradia:
- "Milho da geladeira: alimentação 10/10.";
- o fogão respondeu "Sem fogão nem micro-ondas" (esta conta não comprou);
- o cochilo de 4 h deu "+2 de energia (sem moradia regular, metade)";
- depois, o banho e os dentes responderam "O avatar já está dormindo.".

O interior segue a 60 FPS com as peças novas.

### Animações em casa

| Peça | Animação |
|---|---|
| Geladeira | Abre (`Interact`) e pega o alimento (`PickUp_Table`) |
| Fogão | Pega (`PickUp_Table`) e mexe duas vezes (`Interact`) |
| Cama | Deita no colchão, com a cabeça no travesseiro, **só se o servidor aceitou o descanso**. E, ou mexer, levanta do lado de onde deitou |
| Banheiro | `Interact` |

A UAL não tem clipe de deitar: o corpo gira 90° no colchão (0,52 m) e o clipe parado toca a 45% da velocidade, como respiração. Os outros jogadores na casa veem o deitado: a pose `lie` vai pelo `realtime` (sala `interior`). O `PickUp_Table` entrou no `avatar-pack` (13 clipes no Man).

**PREMISSAS:** colchão a 0,52 m; respiração a 45% da velocidade do parado.

**Testado** em 2026-11-28:
- geladeira: `Interact` → `PickUp_Table` → parado;
- fogão: `PickUp_Table` → `Interact` → parado, com o aviso do servidor ("Sem moradia regular…");
- cama, com o servidor recusando ("O avatar já está dormindo."): o avatar não deitou;
- cama aceita (só na aba, sem gravar no banco): deitado, cabeça a 5,33 m (travesseiro em 5,4 m), parado a 45%, botão "E Levantar"; o E levantou ao lado da cama, de pé e na velocidade normal;
- `realtime`: o teste da sala `interior` aceita a pose `lie`.

**Limites desta versão:**
- A borda segue a grade de 0,5 m (diagonais de 45°); uma curva fina, tirada do polígono da rua, fica para depois.
- A camada de lotes de Pittsburg passa por cima das ruas: com "Lotes" ligado, o chão fica amarelo no street view.
- O avatar ainda não aparece para os outros jogadores (multiplayer, E2.7).

## Pedestres nas calçadas (fase 3)

`pedestres.js` põe gente nas calçadas em volta do avatar. São pedestres do cliente, não jogadores: cada navegador sorteia os seus, e eles não passam pelo `realtime`.

| O quê | Como |
|---|---|
| Corpo | O manequim da UAL (Man ou Woman, sorteado), com a cor da roupa sorteada entre 10 tons, sem sombra própria |
| Onde nascem | Numa célula de calçada da grade do street view, entre 12 m e 35 m do avatar; somem a 45 m ou fora da grade |
| Como andam | Em linha reta, de 1,1 a 1,5 m/s, com o clipe de andar no ritmo do passo. Se 0,9 m à frente não é calçada, ou há alguém a menos de 0,9 m (outro pedestre ou o avatar), viram o menor ângulo livre (±30°, ±60°… 180°) |
| Pausas | De vez em quando param 2 a 6 s; um terço deles conversa (`Idle_Talking_Loop`) |
| Quantidade | Segue o FPS, medido a cada 2 s: abaixo de 45, tira 4 (mínimo 4); acima de 55, põe 2 (máximo 24). Começa com 12 |

`?pedestres=0` desliga. O mapa expõe `__pittsburg.pedestrians()` com `debug()` e `setTarget(n)`.

**PREMISSAS:** até 24 pedestres, de 1,1 a 1,5 m/s, nascendo de 12 a 35 m, somindo a 45 m, com FPS alvo de 45 a 55.

**Testado** em 2026-11-28:
- com 12 pedestres, depois de 6 s: os 12 na calçada, 5,4 m andados em média, 43 viradas, nenhum cercado e no mínimo 1,05 m entre dois deles;
- a 60 FPS, a quantidade subiu até 24;
- com o quadro atrasado de propósito (cerca de 30 FPS), caiu de 24 para 12 em 6 s e voltou a subir quando o FPS voltou a 60;
- no Node: o rumo livre segue reto, vira no fim e na borda da faixa, e devolve null quando está cercado; os 200 sorteios caíram na calçada.

**Limites desta versão:** os pedestres não entram nas lojas.

### Travessia na faixa

Os pedestres usam as faixas de `faixas.js`. As pontas de cada faixa ficam a meia largura da rua mais 0,7 m do centro, e só valem as que caem na calçada.

1. Quem chega a 1,2 m de uma ponta decide uma vez se atravessa (metade atravessa).
2. Espera no meio-fio até não haver carro andando a menos de 12 m da faixa. Depois de 8 s, desiste e segue pela calçada.
3. Cruza em linha reta até a outra ponta, com um desvio lateral sorteado dentro da faixa, e segue pela calçada do outro lado.

Os carros param para quem está atravessando, se ele estiver em qualquer ponto da rua à frente (até 9 m, 4,5 m para cada lado), porque o pedestre vai cruzar as duas faixas.

**PREMISSAS:** metade atravessa; rua livre de carros a 12 m; espera de até 8 s; o carro para a 4,5 m para cada lado.

**Testado** em 2026-11-28, no cruzamento de (-1397, 4857), com 3 faixas usáveis:
- em 40 s, 9 pedestres atravessaram, 7 esperaram um carro no meio-fio e os carros pararam 30 vezes para eles;
- nenhum carro andando passou a menos de 4 m de quem atravessava (160 amostras, depois do segundo commit). Antes, com a parada só na faixa do carro, um carro passou a 2,9 m de lado, a 8,6 m/s;
- em outra rodada de 40 s: 5 atravessaram, 3 desistiram depois de esperar, 13 paradas dos carros.

## Trânsito nas ruas (fase 3)

> **Atualizado em 2026-11-28: o trânsito anda pelas faixas do grafo das ruas** (ver "Trânsito pelas faixas", logo abaixo). O guia pelo meio-fio descrito depois continua só no carro do jogador e nos testes; a preferência pela direita foi trocada por "um carro por vez no cruzamento".

### Trânsito pelas faixas

O guia pelo meio-fio deixava o carro sair na contramão nos cruzamentos, colar no da frente e passar por cima de outro. Agora `carros.js` usa as faixas de `vias.js`, tiradas do grafo das ruas (`ruas-grafo.js`):

| Regra | Como |
|---|---|
| Mão direita | Cada trecho tem uma faixa em cada sentido, a 1/4 da largura da linha do meio (mínimo 1,6 m), à direita de quem anda. O carro segue a geometria da faixa: não tem como ir na contramão nem sair dela |
| Cruzamento | A faixa para antes do cruzamento (0,6 vez a rua mais larga dele). O carro escolhe a saída 30 m antes: reto pesa 3, virar pesa 1. Volta pelo mesmo trecho só no fim de rua. Ele passa numa curva (Bézier) até a faixa nova |
| Um por vez | Só entra no cruzamento quem chega com ele vazio, ou atrás de quem veio da mesma faixa. Os outros esperam 1 m antes do fim da faixa. Assim, quem cruza não passa por cima de ninguém |
| Distância | O IDM (modelo de motorista inteligente) guarda 2,5 m mais 1,2 s de viagem do carro da frente e freia suave pela diferença de velocidade. "Da frente" é medido pelo caminho (a mesma faixa, a faixa de saída somando o que falta da curva, a mesma curva) e pelo rumo, para quem cruza na frente. Quem espera na linha de outra faixa não conta. Colado (menos de 1,5 m), o carro não anda |
| Obstáculos parados | O sinal fechado (o carro para 2,5 m antes da linha), quem atravessa na faixa, o avatar na rua, o carro do jogador estacionado e o ponto de ônibus (o obstáculo fica 2,5 m além da parada, para o ônibus parar nela) |
| Grafo novo | A cada 60 m do avatar, o grafo é refeito, e cada carro numa faixa passa para a faixa nova em que está (até 3 m, no mesmo sentido) |
| Quadro longo | O quadro anda em passos de até 0,05 s, para o IDM não passar do ponto quando a página fica lenta |

Os carros nascem numa faixa entre 30 e 85 m do avatar, a 15 m dos outros, e somem a 110 m ou na borda da grade. Só o carro parado dentro do cruzamento por mais de 30 s sai da cena, como travado; esperar na fila não conta.

**PREMISSAS:** faixa a 1/4 da largura (mínimo 1,6 m); cruzamento a 0,6 vez a rua mais larga; IDM com 2,5 m, 1,2 s, 2 m/s² e 3 m/s²; colado a menos de 1,5 m; passos de 0,05 s.

**Testado** em 2026-11-28:
- no Node, com o `createTraffic` de verdade numa grade de ruas de 10 m a cada 80 m e 10 carros por 2 minutos, conferindo a cada quadro:
  - a 60 quadros por segundo: 0 carros do lado errado da rua fora dos cruzamentos e 0 fora da rua, em 71.940 amostras; 0 sobreposições (caixas de 4,2 × 1,8 m, com o teste de eixos separadores); a menor folga na fila foi de 4,07 m; nenhum travado; 104 passagens por cruzamento (61 retas, 19 à esquerda, 24 à direita);
  - a 2 quadros por segundo (passo de 0,5 s): 0 do lado errado e 0 sobreposições, a menor folga foi de 4,08 m;
  - no caminho: na primeira versão, com 10 carros, houve 132 amostras de sobreposição. O "da frente" só pelo rumo não via o carro parado logo depois do cruzamento enquanto o outro fazia a curva. A medida pelo caminho resolveu;
- no navegador, no cruzamento de (-2044,6; 4290,9), com 10 carros por 1 minuto: 0 do lado errado, 0 fora da rua e 0 sobreposições, em 2.394 amostras; 27 paradas no vermelho, 41 para pedestres, 8 esperas na entrada do cruzamento e nenhum travado. Na captura, o carro que se afasta vai à direita da linha amarela, e o que cruza passa sozinho no cruzamento;
- o ônibus posto 30 m antes do ponto parou a 1,3 m da parada e abriu a porta. Antes da correção, parava 2,9 m antes e não abria;
- a página do painel, fora de foco, rodava a 2 ou 3 quadros por segundo. O FPS baixava a quantidade de carros para 2, e nos testes a quantidade ficou fixa em 10.


`carros.js` põe carros nas ruas em volta do avatar, na mão direita. Como os pedestres, são do cliente: não passam pelo `realtime`.

O OSM da cidade só traz o polígono das ruas, sem a linha do meio. O carro se guia pelo chão, como quem dirige olhando o meio-fio:

| Situação | O que o carro faz |
|---|---|
| Rua comum | Um "bigode" à direita mede a distância até o fim da rua, e o carro corrige o rumo para ficar a 1,8 m do meio-fio. A correção é amortecida pela velocidade do erro, para não ziguezaguear |
| A direita abre mais de 2,5 m além da faixa (cruzamento, rua que sai) | Sorteia uma vez: segue reto até a direita fechar, ou entra à direita |
| A frente fecha a menos de 6 m (fim da rua, T) | Vira para o lado com mais rua |
| Outro carro à frente (até 9 m, numa faixa de 1,4 m) | Freia forte e volta a acelerar devagar |
| O avatar na rua à frente (até 9 m, numa faixa de 2,6 m, ou a menos de 5 m) | Para |

- Nascem numa rua de 5 m de largura ou mais, entre 30 m e 70 m do avatar, já na faixa da direita, e somem a 90 m.
- O carro é uma peça procedural (carroceria, cabine, rodas, faróis brancos na frente e vermelhos atrás) em 8 cores, até haver o modelo CC0 do SCC Kit.
- A quantidade segue o FPS, como os pedestres: abaixo de 45, tira 2 (mínimo 2); acima de 55, põe 1 (máximo 10). Começa com 6.
- `?transito=0` desliga. O mapa expõe `__pittsburg.traffic()` com `debug()` e `setTarget(n)`.

**PREMISSAS:** até 10 carros, de 7 a 10 m/s (25 a 36 km/h), faixa a 1,8 m do meio-fio da direita, mão direita.

**Testado** em 2026-11-28:
- no navegador, 10 carros por 10 s: nenhum fora da rua em 155 amostras, e a distância mediana ao meio-fio da direita ficou em 1,8 m;
- com o avatar parado na rua, 14 m à frente de um carro a 6 a 8 m/s: o carro parou a 4,5 m, 5 m e 7 m nas três tentativas;
- no Node, em duas ruas de 10 m que se cruzam: seguindo reto, atravessou o cruzamento; entrando, virou à direita e ficou na faixa; numa rua sem saída, deu a volta. Nenhum passo fora da rua, e no máximo 0,3 m fora da faixa.

### Preferência pela direita

No cruzamento sem semáforo, o carro dá a preferência para quem vem pela direita. Ele espera se outro carro:

- cruza o caminho dele (rumos a mais de 60° um do outro);
- está à direita, de 1 a 12 m de lado, e até 14 m à frente;
- vai para o caminho dele.

Quem já está esperando parado não segura os outros. Se quatro carros chegam juntos, cada um com outro à direita, ninguém sairia: depois de 4 s esperando, o carro vai e ignora a regra por 3 s. Perto de um semáforo (25 m), quem manda é a luz.

**PREMISSAS:** até 14 m à frente, de 1 a 12 m à direita; destrave em 4 s, por 3 s.

**Testado** em 2026-11-28:
- no Node, num cruzamento em + com dois carros chegando juntos: o que tinha o outro à direita esperou 0,9 s, e a menor distância entre eles foi de 11,7 m (sem a regra, 4,3 m). Na mesma rua, em sentidos opostos, ninguém esperou;
- no navegador, no T de (-1397, 4857) com `?semaforos=0` e 10 carros por 40 s: 7 preferências dadas, nenhum par de carros que se cruzam a menos de 3 m (a menor distância foi 3,5 m) e nenhum destrave.

**Limites desta versão:** o carro não vira à esquerda. O carro já para para o pedestre que atravessa na faixa ([travessia](#travessia-na-faixa)) e no semáforo ([semáforos](#semáforos-nos-cruzamentos-fase-3)).

## Semáforos nos cruzamentos (fase 3)

`semaforos.js` põe semáforo onde há duas ou mais faixas de pedestre a menos de 22 m umas das outras (um cruzamento). Faixa sozinha continua sem semáforo, com a regra de olhar os carros.

- **Grupos:** cada faixa é um braço do cruzamento. Os braços se dividem em dois grupos pelo rumo da rua: o do primeiro braço e os que ficam a menos de 30° dele, e os outros. Num cruzamento em +, os braços opostos ficam no mesmo grupo; num T, a rua que passa é um grupo e a que chega é o outro.
- **Ciclo de 33 s:** grupo 1 verde 12 s, amarelo 3 s, todos no vermelho 1,5 s; depois o grupo 2, igual. Os dois grupos nunca ficam verdes ou amarelos ao mesmo tempo. O ciclo de cada cruzamento começa num ponto sorteado pela posição dele.
- **Postes:** um em cada ponta da faixa, com a caixa e as três luzes viradas para quem chega. As luzes acendem pela cor do braço.
- **Carro:** no vermelho, para antes da faixa (1 m antes da listra), freando a até 3 m/s². No amarelo, para se ainda faltam mais de 4 m até a linha; senão, segue. Só conta a faixa da rua dele, de quem chega ao cruzamento.
- **Pedestre:** começa a atravessar quando os carros daquele braço estão no vermelho, se ainda falta vermelho para cruzar a rua inteira (largura ÷ 1,1 m/s + 1 s) e nenhum carro andando está a menos de 5 m da faixa. Espera até 35 s.

`?semaforos=0` desliga. O mapa expõe `__pittsburg.signals()` com `arms()`, `walkOk(faixa)` e `debug()`.

**PREMISSAS:** cruzamento com faixas a menos de 22 m; ciclo de 33 s (12 + 3 + 1,5 por grupo); grupos por 30°; parada 1 m antes da faixa; amarelo segue a menos de 4 m.

**Testado** em 2026-11-28, no cruzamento em T de (-1397, 4857):
- 1 cruzamento, 3 braços (2 no grupo da rua que passa, 1 no da que chega) e 6 postes; as três cores apareceram;
- em 30 s, os carros pararam 25 vezes no vermelho. Entrando no cruzamento, um carro foi visto na faixa com o vermelho numa amostra só (0,25 s), o que bate com o carro que passou a linha no amarelo. Os outros 5 casos eram carros saindo do cruzamento pela rua em que tinham virado;
- pedestres na faixa com o verde dos carros: 76 em 291 amostras na primeira versão, que deixava começar a travessia no fim do vermelho; 6 em 243 depois do segundo commit, que pede vermelho para cruzar a rua toda. Quem ainda está na faixa continua protegido: o carro para para ele;
- no Node, o ciclo dá a sequência esperada para os dois grupos, e o cruzamento em + sai com 4 braços em 2 grupos, sem a faixa solta.

## Ônibus e pontos de ônibus (fase 3)

O OSM de Pittsburg não traz os pontos. `onibus.js` os tira da grade da calçada:

- cada célula de meio-fio tem um sorteio fixo pela posição no mundo, e cerca de 1 em 350 vira ponto, numa rua de 7 m ou mais e a pelo menos 60 m do ponto vizinho;
- o abrigo é procedural (cobertura, fundo de vidro, banco, colunas e a placa amarela), virado para a rua, a 1,2 m do meio-fio; o fundo e o banco não são andáveis;
- cada ponto tem a espera do pedestre (na frente do banco) e a parada do ônibus (na rua, a 1,6 m do meio-fio).

O sorteio é da célula, não da grade, e a grade da calçada agora fica alinhada a múltiplos de 0,5 m no mundo. Por isso, refazer a grade em outro centro dá os mesmos pontos (e os mesmos postes e árvores). Na primeira versão, com um sorteio por quadrado de 120 m, a melhor célula do quadrado mudava com o recorte da grade, e o ponto pulava de lugar.

| Quem | O que faz |
|---|---|
| Ônibus | Com 3 carros ou mais, um é ônibus: 11 m, verde, 8 m/s. Anda como os carros e, com um ponto à frente na faixa dele (até 35 m, a menos de 2,5 m de lado), freia a 1,5 m/s² até a parada e fica 7 s parado. Depois segue e não para de novo no mesmo ponto |
| Pedestre | Passando a 2,5 m de um ponto, 40% vão esperar nele, na frente do banco e de frente para a rua (até 45 s). Com o ônibus parado e a porta a menos de 10 m, andam até a porta e saem da cena (embarcaram) |
| Os outros carros | Freiam atrás do ônibus contando o comprimento dele |

Os pontos só existem na grade em volta do avatar (40 m): o ônibus só para nos pontos perto do jogador, que são os que aparecem na tela. O mapa expõe `streetView.busStops()` e, para os testes, `traffic().placeBus(x, z, rumo)`.

**PREMISSAS:** 1 em 350 células de meio-fio, 60 m entre pontos, rua de 7 m; ônibus de 11 m a 8 m/s, 7 s no ponto; 40% dos pedestres esperam, até 45 s.

**Testado** em 2026-11-28, perto do cruzamento de (-1397, 4857):
- o ponto de (-1392,2; 4863,2) apareceu igual nas grades de 4 centros diferentes;
- o ônibus posto 30 m antes dele freou (6 → 2,4 m/s), parou a 1 m da parada, ficou 7 s e seguiu; 4 pedestres embarcaram;
- as 3 faixas do cruzamento seguem lá depois do alinhamento da grade.

**Limites desta versão:** o ônibus não segue uma linha fixa.

### O avatar anda de ônibus

`viagem.js` deixa o avatar embarcar:

1. No ponto, a menos de 4 m da espera, com o ônibus parado e a porta a menos de 12 m, aparece **E Ônibus no ponto: passagem · 3,00 THALER**. Como é dinheiro, o 1º E pede confirmação e o 2º, em 4 s, paga.
2. A passagem sai pelo game-core: `POST /v1/avatars/:id/bus-ride` cobra pelo ledger o mesmo preço do deslocamento de ônibus do turno (`COMMUTES.onibus`, 3 THALER), para a queima `transit` (kind `bus_fare`), com Idempotency-Key. Não embarca internado, dormindo nem de cama. Sem a cobrança aceita, ninguém embarca. O catálogo da rotina (`/v1/catalog/routine`) mostra `bus_fare`.
3. Embarcado, o avatar some e vai junto com o ônibus. A câmera se afasta (13 m) e acompanha o rumo dele, e o teclado e o clique não andam. Com o avatar dentro, o ônibus não sai da cena e não freia por ele.
4. No próximo ponto em que o ônibus para, o avatar desce na calçada, na espera do ponto ("Desceu no ponto."). Se o ônibus sumir, ou a viagem passar de 4 min, ele desce onde está.

**Carro travado:** com o ônibus andando por mais tempo, apareceu um nó no cruzamento (um carro na contramão e outro cruzando na frente, todos parados para sempre). Agora, um carro travado só por outros carros por mais de 8 s sai da cena, e nasce outro em outro lugar. O ônibus com o avatar dentro não sai: passa pelos carros por 3 s.

**PREMISSAS:** embarque a menos de 4 m da espera, com a porta a menos de 12 m; viagem de até 4 min; carro travado sai depois de 8 s.

**Testado** em 2026-11-28, com a conta de teste no ambiente local:
- game-core: 5 testes novos (preço igual ao do turno, sem efeito no avatar; internado, dormindo e de cama não embarcam, com dor de cabeça embarca; a perna do ledger vai para `transit`; a mesma Idempotency-Key cobra uma vez; sem THALER, 409; de outra conta, 404; o catálogo mostra `bus_fare`). A suíte do game-core passa (305 testes), e o OpenAPI bate com as rotas;
- no navegador, no ponto de (-1392,2; 4863,2), com o ônibus parado: o E armou "Ônibus no ponto: passagem · 3,00 THALER" e o 2º E embarcou ("No ônibus: desce no próximo ponto."). O saldo caiu exatamente 3 THALER a cada viagem (de 9.698,00 para 9.695,00 e depois para 9.692,00);
- na primeira viagem, o ônibus ficou preso num nó no cruzamento de (-1455, 4704). Com o destrave, a segunda viagem levou 92 s e cerca de 290 m, e o avatar desceu na calçada do ponto de (-1452,5; 4578,3), visível de novo.

## Sons da cidade (fase 3)

`sons.js` sintetiza os sons com a Web Audio. Não há arquivo de som: nada para baixar nem licenciar.

| Som | Como |
|---|---|
| Fundo da cidade | Ruído filtrado em 350 Hz, a 3% do volume, constante |
| Motores | 4 vozes (dente de serra filtrado com um pouco de ruído) presas aos 4 carros mais perto e posicionadas no espaço. O tom sobe com a velocidade (45 a 95 Hz; o ônibus, 30 a 60 Hz e mais alto). Parado, o motor fica em marcha lenta, a 40% |
| Passos do avatar | Um estalo curto de ruído a cada passo: 0,5 s andando, 0,32 s correndo; nada no ar |
| Bipe da travessia | No semáforo a menos de 15 m, um bipe de 880 Hz por segundo enquanto o pedestre pode atravessar |

O ouvinte fica na câmera. O navegador só deixa tocar depois de um gesto, então o som começa no primeiro clique ou tecla do street view. O botão **Som** na barra liga e desliga, e a escolha fica salva neste navegador. `?som=0` tira o botão e o áudio.

**PREMISSAS:** 4 vozes de motor; fundo a 3%; motor de 45 a 95 Hz (ônibus de 30 a 60 Hz); distância de referência de 6 m; bipe a menos de 15 m.

**Testado** em 2026-11-28, no cruzamento de (-1397, 4857), sem ouvir (o painel não tem saída de som), pelo estado da Web Audio:
- depois de uma tecla de verdade, o contexto ficou "running";
- andando 4 s, 7 passos;
- as 4 vozes presas aos carros mais perto (de 5,8 m a 38,6 m), o ônibus em 30 a 33 Hz, os carros parados em marcha lenta;
- perto da faixa com semáforo, o bipe tocou;
- o botão passou a "Som: desligado", salvou "0", e voltou a "Som: ligado" e "1".

## Minimapa e GPS (fase 4)

`minimapa.js` põe um minimapa redondo no canto de cima, à direita, com 160 m em volta do avatar. Ele gira com a câmera: a frente fica sempre para cima, e o N no anel mostra o norte.

| No minimapa | Como |
|---|---|
| Ruas | Saem do próprio índice das ruas do street view (`isRoad`), amostradas a cada 1 m num quadro de 240 m. O quadro é refeito quando o avatar se afasta 50 m do centro dele |
| Carros e ônibus | Laranja; o ônibus, verde e maior |
| Pedestres | Pontos cinza |
| Pontos de ônibus | Quadrados azuis |
| Semáforos | Na cor de agora |
| Lugares do jogo | Quadrados roxos (Loja do jogo, Farmácia, Mercado); o destino do GPS, amarelo |
| Avatar | A seta branca no centro, no rumo do corpo |

O minimapa redesenha a 15 quadros por segundo.

**GPS:** no seletor embaixo do minimapa, escolhe-se um lugar.
- A rota sai do mesmo A* do clique de andar (`caminho.js`), numa grade de 2 m só pelas ruas, e vai da rua mais perto até a porta.
- Aparece como a linha amarela no minimapa e, embaixo, como a distância que falta ("Farmácia · 276 m").
- É refeita a cada 3 s, ou quando o avatar sai 15 m do trecho atual.
- A 12 m do lugar, mostra "Chegou" e desliga.

`?minimapa=0` tira o minimapa. O mapa expõe `__pittsburg.minimap()` com `go(lugar)` e `debug()`.

**PREMISSAS:** 160 m de minimapa (raio de 80 m) em 180 px (120 px no celular); ruas a cada 1 m num quadro de 240 m; GPS numa grade de 2 m, até 150 mil nós; refeito a cada 3 s ou 15 m fora; chegada a 12 m.

**Testado** em 2026-11-28:
- no Node, numa grade de ruas de 10 m a cada 100 m: 654 m de rota (o caminho em ângulo reto tem 700 m; a rota corta as esquinas dentro da largura da rua), 8 pontos, todos na rua, em 30 ms. Para o meio do quarteirão, não há rota;
- no navegador, do ponto de ônibus de (-1452, 4578) até a Farmácia: a rota de 276 m, com 6 pontos, saiu em 3 a 5 ms. Andando por ela em saltos de 20 m, a distância caiu de 276 m para 37 m e o GPS mostrou "Chegou: Farmácia" a 11 m da porta;
- a primeira versão refazia a rota a cada quadro (7 vezes em 0,4 s), porque media a distância até o próximo ponto, que fica longe numa rua reta. O segundo commit mede até o trecho atual: na mesma viagem, a rota só foi refeita pelo relógio de 3 s (4 vezes);
- na captura, o minimapa está no canto, com a rota amarela e "Farmácia · 276 m".

## O próprio carro (fase 4)

`carro-jogo.js` deixa o jogador dirigir o carro da conta (comprado ou alugado na agência, E3.5).

1. **Meu carro**, na barra, aparece quando a conta tem um carro em dia. Ele chama o carro, que estaciona na faixa da direita da rua mais perto, do lado do avatar.
2. Perto do carro (3 m), aparece **E Hatch: combustível · 2,00 THALER**. Como é dinheiro, o 1º E confirma e o 2º, em 4 s, paga.
3. O game-core confere e cobra: `POST /v1/avatars/:id/drive` com `{vehicle}` exige a habilitação (`no_license`, ou `in_driving_school` antes das 3 h) e o carro em dia (`vehicle_unavailable` com IPVA atrasado, quebra, vida útil ou aluguel vencido). Cobra o combustível da saída, o mesmo do deslocamento de carro do turno (`COMMUTES.carro`, 2 THALER), para a queima `fuel` (kind `drive_fuel`), uma vez por Idempotency-Key. A cobrança é na entrada, então o navegador não informa distância. O catálogo da rotina mostra `drive_fuel`.
4. **Dirigindo** (arcade):
   - W acelera (4 m/s²) até a velocidade do modelo (Hatch 50 km/h, Sedã 70, Superesportivo 90);
   - S freia (8 m/s²) e dá ré até 4 m/s; A e D viram, com menos esterço com mais velocidade;
   - o carro só anda na rua: a frente fora dela para o carro;
   - ele para atrás de outro carro (3,5 m) e na frente de quem atravessa;
   - a câmera vai atrás do carro, a 7 m, e o som do motor dele entra nas vozes.
5. **E** de novo: o avatar sai na calçada do lado direito, e o carro fica estacionado ali. O trânsito freia atrás dele.

**PREMISSAS:** aceleração de 4 m/s², freio de 8 m/s², ré até 4 m/s; esterço de até 0,5 rad (35% dele a 20 m/s), entre-eixos de 2,6 m; parada a 3,5 m de outro carro; embarque a 3 m.

**Testado** em 2026-11-28:
- game-core: 3 testes novos.
  - Sem habilitação não dirige, e na autoescola também não. Habilitado, paga 200 centavos por saída, uma vez por chave, para `fuel`.
  - IPVA atrasado é `vehicle_unavailable`; o carro de outra conta é 404; sem THALER, 409; o catálogo mostra `drive_fuel`.
  - A suíte do game-core passa (307 testes; um teste do Postgres que oscilou passou sozinho), e o OpenAPI bate.
- No Node: em linha reta, chegou aos 50 km/h do Hatch e parou no fim da rua sem sair dela. Bloqueado, para. A ré vai até 4 m/s. A 36 km/h, 1 s de esterço vira 73°: a primeira versão virava 111° e ficava arisca.
- No navegador, com a conta de teste local (autorizado):
  - o preparo foi alugar um Hatch por 3 dias (150 THALER) e fazer a autoescola (50 THALER), as duas pelas rotas do jogo, e adiantar no banco local o fim das 3 h da habilitação;
  - **Meu carro** estacionou o Hatch na rua, e o 2º E deu "Combustível: −2,00 THALER";
  - com W, a velocidade subiu de 2 em 2 m/s até 13,9 m/s (50 km/h), 59 m na rua, sem bater;
  - o saldo caiu exatamente 2 THALER (9.492,00 → 9.490,00);
  - o E tirou o avatar para a calçada, a 4 m do carro, que ficou estacionado;
  - na captura, o Hatch vermelho visto de trás, com o minimapa no canto.

### O carro para os outros jogadores

Dirigindo, o carro vai para quem está no mesmo bairro, pelo `realtime`:
- **Servidor** (sala `district`): o modo `drive`, além de `map` e `street`. O campo `vehicle` traz o modelo (`hatch`, `sedan` ou `super`; o desconhecido vira `hatch`, e a pé fica vazio). A velocidade vai até 30 m/s dirigindo (10 m/s a pé).
- **Quem dirige** (`multiplayer.js`): manda a posição, o rumo e a velocidade do carro, com o modelo.
- **Quem vê:** desenha o mesmo carro do modelo (`carMesh`, de `carro-jogo.js`), com o nome do jogador em cima. O carro desliza na velocidade recebida, salta se estiver longe demais e vira para o rumo. O avatar a pé daquele jogador fica escondido enquanto ele dirige.

**Testado** em 2026-11-28:
- `realtime`: o teste da sala cobre o modelo que chega aos outros, a velocidade até 30 m/s, o modelo desconhecido que vira `hatch` e o modelo que some ao voltar a pé. A suíte passa (22 testes);
- no navegador, com duas abas no mesmo bairro (2) e um `realtime` desta versão numa porta à parte:
  - a aba A chamou o Hatch e saiu dirigindo (mais 2 THALER de combustível na conta de teste local);
  - a aba B viu o carro: modo `drive`, `hatch`, visível, sem o avatar a pé. Na captura, o Hatch vermelho com "Recepcionista 08dE" em cima, e "2 jogadores aqui";
  - a aba A andou de z 4626,5 para 4650,2, e a B recebeu o carro em z 4660,8 (onde ele parou depois de soltar o acelerador);
  - a aba A saiu do carro, e a B passou a ver o avatar a pé, sem o carro.

**O trânsito freia pelos outros jogadores.** O multiplayer passa ao trânsito os outros jogadores na rua (`obstacles()`), onde aparecem na tela. O carro de quem dirige conta como o carro da frente, com a velocidade dele. Quem anda na rua conta como o avatar: o carro para.

**Testado** em 2026-11-28:
- no Node, com o `createTraffic` de verdade, 10 carros por 2 minutos, um carro de outro jogador parado no meio de uma faixa e uma pessoa na rua em outra faixa: 0 batidas no carro e 0 atropelamentos. Os carros pararam atrás do carro do outro (3.688 amostras de carro parado a menos de 12 m, no mesmo sentido) e ficaram a pelo menos 5,06 m da pessoa;
- no navegador, com duas abas no bairro 8 e um `realtime` desta versão numa porta à parte:
  - a aba A parou o Hatch no meio da rua, em (-2007,5; 4314);
  - na aba B, com 10 carros por 1 minuto: 0 batidas no carro de A, 151 amostras de carro parado atrás dele, e a menor distância de 5,1 m entre os centros;
  - na captura, a fila na faixa da direita atrás do carro de A.

**O carro estacionado também aparece.**
- **Servidor:** o campo `vehicle` passou a ser o carro do jogador na rua, dirigindo ou estacionado, com `carX`, `carZ` e `carRot`. A pé, o cliente manda o carro chamado (`car: {x, z, rot, model}`). Ele só vale a até 200 m de quem anda; sem ele, o carro some.
- **Quem vê:** desenha o carro onde o dono o deixou, junto com o avatar a pé. O trânsito freia por ele como por um carro parado.

**Testado** em 2026-11-28:
- `realtime`: o teste da sala cobre o carro estacionado que chega aos outros com a posição e o rumo, e o que fica a mais de 200 m e não vale. A suíte passa (22 testes);
- no navegador, com duas abas no bairro 8, a aba A chamou o Hatch, sem dirigir (sem combustível), e ficou a pé ao lado;
- a aba B viu os dois: o avatar a pé de A e o Hatch estacionado em (-2007,5; 4314), onde A o deixou;
- com 10 carros por 1 minuto na aba B: 0 batidas no carro estacionado, 254 amostras de carro parado atrás dele, a no mínimo 5,1 m. Na captura, a fila até o Hatch de A, com o nome dele em cima e o avatar na calçada. O GPS já tem o trabalho como destino ([locais de trabalho](#locais-de-trabalho-fase-4)).
## Locais de trabalho (fase 4)

O turno do game-core não tem lugar: o avatar trabalha pelo painel (`POST /v1/avatars/:id/work`). Para o GPS ter o trabalho como destino, `trabalho.js` divide as 44 profissões do catálogo em 12 setores. Cada setor tem um prédio na rua, com a mesma casca da loja do jogo e da farmácia: paredes, porta, letreiro e um balcão no fundo.

| Setor | Letreiro | Profissões |
|---|---|---|
| Padaria e Cozinha | PADARIA | padeiro, confeiteiro, cozinheiro, chef, garçom |
| Hospital | HOSPITAL | enfermeira, dentista, farmacêutico, médico |
| Escola | ESCOLA | professor, orientador escolar, coordenador escolar, diretor |
| Delegacia e Bombeiros | DELEGACIA | bombeiro, policial, perito, delegado |
| Construtora | CONSTRUTORA | pedreiro, construtor, arquiteto, engenheiro civil, incorporador |
| Imobiliária | IMOBILIÁRIA | corretor e consultor de imóveis, administrador de condomínio |
| Clínica Pet | CLÍNICA PET | tosador, pet sitter, adestrador, veterinário |
| Ateliê de Moda | ATELIÊ | alfaiate, modelista, designer de acessórios, estilista |
| Cooperativa do Campo | COOPERATIVA | agricultor, pescador, fazendeiro, agrônomo |
| Garagem de Transportes | GARAGEM | motorista, mecânico |
| Hotel | HOTEL | recepcionista, concierge, hoteleiro |
| Escritório da Aviação | AVIAÇÃO | piloto, astronauta |

- **Os lugares:**
  - saíram de uma busca no street view, perto das lojas, sobre o grafo das ruas;
  - a frente do prédio fica atrás da calçada (meia largura da rua mais 3,2 m da linha do meio), virada para a rua;
  - o prédio inteiro (12 × 10 m, mais 1 m de folga) fica fora das ruas, a pelo menos 35 m dos outros e das lojas, e a até 450 m da loja do jogo;
  - os prédios não ocupam lotes do jogo (que estão à venda): ficam na beira da calçada, como as lojas.
- **O GPS** ganha **Trabalho: <setor>**, com o setor da profissão do avatar. Dentro do próprio trabalho, o aviso diz que o turno é pelo painel. Nos outros prédios, diz para quantas profissões é aquele trabalho.
- **Só a cena:** o turno, o pagamento e o deslocamento seguem do jeito que são. O mapa expõe `__pittsburg.workplaces()` com `myPlace()` e `debug()`.

**PREMISSAS:** os 12 setores e quem fica em cada um, os lugares em Pittsburg, e o tamanho de 12 × 10 m.

**Testado** em 2026-11-28:
- no Node, as 44 profissões do catálogo caem cada uma num setor só, sem sobrar e sem repetir. Os 12 lugares ficam a pelo menos 36 m um do outro;
- no navegador, com a conta de teste (recepcionista):
  - o GPS ofereceu **Trabalho: Hotel**, com uma rota de 134 m saindo de (-1397, 4857);
  - andando por ela, deu "Chegou: Trabalho: Hotel";
  - na captura, o prédio do HOTEL, com o letreiro virado para a rua;
  - dentro dele, "Hotel: o seu trabalho (Recepcionista). O turno é pelo painel, em Trabalhar."; na padaria, "Padaria e Cozinha: trabalho de 5 profissões."

## Celular do personagem

Os painéis do mapa ficam escondidos no street view. `celular.js` traz o essencial deles para a rua. Ele abre no botão **Celular** da barra ou na tecla **C**, e fecha com o C, o Esc ou o botão de voltar.

| App | O que faz |
|---|---|
| Carteira | THALER e SCITY (o SCITY com 18 casas, mostrado com 2). Depósitos, saques e câmbio continuam no painel do mapa |
| Status | Os atributos do avatar (0 a 10, em barras vermelhas até 3, amarelas até 6), a profissão, a moradia (regular ou não) e o que ele pode fazer agora (trabalhar, dormindo, internado, no mercado) |
| GPS | Os destinos do minimapa (loja, farmácia, mercado e o trabalho). Escolher liga o GPS e fecha o celular |
| Carro | Chama o próprio carro, se a conta tem um em dia |
| Chat | Fecha o celular e põe o cursor na caixa de mensagem do bairro |
| Mapa | Volta para o mapa |

Ao abrir, o celular pede um refresh do servidor e se redesenha. Ele só mostra e atalha: nada nele cobra ou muda o jogo. O mapa expõe `__pittsburg.phone()` com `open(tela)` e `debug()`.

**Testado** em 2026-11-28, com a conta de teste:
- carteira: 9.484,00 THALER (o saldo de 948.400 centavos) e 500,00 SCITY;
- status: Recepcionista, alimentação 7, energia 10, saúde 10, higiene 8, felicidade 9, "Pode trabalhar", "Sem moradia regular (turno a 50%)";
- GPS: Loja do jogo, Farmácia, Mercado da Prefeitura e Trabalho: Hotel. Escolher o trabalho ligou a rota no minimapa ("Trabalho: Hotel · 134 m") e fechou o celular;
- carro: "Hatch" com "Chamar o carro para cá";
- chat: o cursor foi para a caixa "Mensagem para o bairro";
- a tecla C (de verdade) fechou e abriu o celular, e o Esc fechou;
- na primeira captura, a linha da moradia saiu colada ("CasaSem moradia…"). Ganhou espaço entre o rótulo e o valor.

## Kit de ruas (redesenho das ruas)

As ruas do street view vão ser redesenhadas com as peças do **"modular kit city build v2"** (FBX, Blend e texturas, em `C:Projeto-GitSmartChainCityouds`).

**Licença:** o kit não traz arquivo de licença, e o FBX não diz o autor. Até a licença ser confirmada, nada dele vai para o repositório: o kit fica em `.local/rouds/`, que o git ignora. O mapa só usa o kit se ele estiver lá; sem ele, ficam as ruas de hoje. Vai para o repositório só o código: a ferramenta que tira as peças e o encaixe nas ruas.

**O que há no FBX:** uma cena com 321 peças soltas, em centímetros, chamadas só "modular_kitNN", com um atlas de 67 MB. Conferidas de cima, uma a uma:

| Código | Peça do FBX | Medidas | O que é |
|---|---|---|---|
| `reta2` | 05 | 7,71 × 5,70 m | 2 faixas, com a linha amarela no meio |
| `reta4` | 02 | 15,42 × 5,70 m | 4 faixas |
| `cruz2` | 238, 239 e 240 | 18,81 × 18,81 m | Cruzamento em + de 2 faixas, com faixas de pedestre e "STOP". O miolo e o asfalto dos braços dos lados são três peças, juntadas |
| `cruz4` | 237 | 26,52 × 26,52 m | Cruzamento em + de 4 faixas |
| `faixa` | 65 | 15,42 × 1,43 m | Faixa de pedestre de 4 faixas |
| `meiofio` | 17 | 1,43 × 5,70 m, 15 cm de altura | Meio-fio |
| `calcada` | 14 | 5,70 × 5,70 m | Piso da calçada |
| `asfalto` | 233 | 7,71 × 7,71 m | Asfalto liso, para os trechos em que nenhuma peça cabe |

O kit também tem curvas de vários raios, retas de 3 faixas, estacionamento, trilho, uma ponte e os cruzamentos com faixa de conversão (232, 234, 236). Não tem peça de T: o T vai ser o + com um braço fechado por meio-fio e calçada.

**A ferramenta:** `tools/scc-builder/bin/road-kit.js` lê o FBX com o FBXLoader do three, no Node, e grava em `.local/rouds/`:
- `kit-ruas.glb`: as 8 peças, uma por nó, com o código dela, em metros, com o centro na origem e o chão em y = 0. A rua corre em z, como já é no FBX. As retas são mais largas que compridas, então o eixo mais comprido não diz o sentido da rua, e nada é girado. O GLB tem 2,9 MB, com o atlas reduzido a 4096 px em JPEG pelo sharp;
- `kit-ruas.json`: as medidas de cada peça, para o encaixe.

```
cd tools/scc-builder
node bin/road-kit.js <kit.fbx> <pasta-das-texturas> ../../.local/rouds
```

**Plano do redesenho:**
1. A ferramenta, com o teste (feito).
2. O grafo das ruas em volta do avatar (feito, abaixo).
3. O encaixe das peças (feito, abaixo). A partir das ruas do OSM, sai a linha do meio de cada rua, com a largura e os cruzamentos (o esqueleto da grade das ruas). A grade é alinhada ao mundo, então o grafo dá o mesmo em toda a cidade.
3. O encaixe:
   - nos cruzamentos de 4 braços perto de 90°, a peça de cruzamento (de 2 ou 4 faixas, pela largura);
   - nos T, o + com o braço fechado;
   - ao longo dos trechos, as retas, giradas pelo rumo da rua;
   - onde nenhuma peça cabe, o asfalto do kit sobre o polígono do OSM.

### O grafo das ruas

`ruas-grafo.js` tira do polígono das ruas a linha do meio, a largura e os cruzamentos, em volta do avatar:

1. Grade de 1 m, alinhada ao mundo, num quadrado de 240 m: cada célula é rua ou não.
2. A distância de cada célula de rua até a borda dá a meia largura (transformada de distância).
3. O afinamento de Zhang-Suen deixa a rua com uma célula de largura, no meio dela: o esqueleto.
4. Nós são as células do esqueleto com 3 ou mais vizinhos (o cruzamento, juntado num nó só) ou com 1 (o fim da rua). Trechos são o caminho entre dois nós, simplificado a 1 m, com a largura mediana.
5. Limpeza:
   - o espinho (trecho que acaba solto, mais curto que 1,5 vez a largura) sai;
   - dois cruzamentos colados viram um, se o trecho entre eles for mais curto que 1,2 vez a rua mais larga, ou que 2 vezes quando os 4 braços formam duas ruas retas (o X em ângulo agudo, que o afinamento parte em dois T);
   - os nós que ficam com 2 trechos se juntam.

Cada nó diz o tipo: `cruz` (4 braços), `T` (3), `fim` (1), `borda` (1, na borda da grade: a rua segue) ou `outro` (5 ou mais), com os rumos dos braços. O grafo é refeito quando o avatar se afasta 60 m. `?grafo=1` desenha o grafo na rua. O mapa expõe `__pittsburg.roadGraph()` com `graph()` e `debug()`.

**PREMISSAS:** grade de 1 m num quadrado de 240 m; Douglas-Peucker a 1 m; espinho abaixo de 1,5 vez a largura; cruzamentos colados abaixo de 1,2 vez a rua mais larga (2 vezes no X); refeito a cada 60 m.

**Testado** em 2026-11-28:
- no Node, com ruas de teste (de 15 a 55 ms cada):
  - o + dá 1 cruzamento com os braços a 0°, 90°, 180° e 270°; o T, 1 T com 90°, 180° e 270°;
  - o L e a reta não dão cruzamento;
  - a rua de 16 m cruzando a de 8 m sai com as duas larguras;
  - o X a 45° dá 1 cruzamento (na primeira versão, dava dois T a 15 m um do outro);
  - dois T desencontrados a 30 m continuam dois;
  - as pontas cortadas pela borda da grade saem como `borda`, não como `fim`;
- no navegador, em (-1397, 4857), o grafo saiu em 62 ms, com 6 trechos (larguras de 4,3 a 9,7 m) e o T onde estão as faixas de pedestre (a 3,4 m delas). Desenhado de cima sobre a grade das ruas, as linhas do meio seguem as ruas.

### As peças nas ruas

`kit-ruas.js` lê `.local/rouds/kit-ruas.glb` e, a cada grafo novo (a cada 60 m em volta do avatar), põe as peças:

| No grafo | Peça |
|---|---|
| Cruzamento de 4 braços em ângulo reto (até 20° fora) | `cruz2`, ou `cruz4` se a rua mais larga passar de 12 m. A peça é girada pelo 1º braço, com a escala pela largura (entre 0,6 e 1,6) |
| T em ângulo reto | A mesma peça, com o braço que falta coberto pelo piso da calçada |
| Trecho | Uma fita contínua ao longo da linha do meio, na largura da rua, com a textura da `reta2` (ou da `reta4`, acima de 12 m). A textura é recortada do atlas pela transformação afim de três cantos da peça e repetida a cada 5,70 m. Nas dobras, a fita vira em chanfro: as bordas se encontram, e a largura não afina. A fita começa e acaba fora da peça de cruzamento |
| O resto (X agudo, 5 braços, rua torta) | O asfalto do OSM, que continua por baixo |

- As peças ficam 3 cm acima do asfalto do OSM.
- Com o kit, o asfalto do OSM ganha a textura do asfalto liso do kit (recortada do atlas, repetida a cada 7,71 m pelo mundo), para não destoar das peças. Isso vale também para o mapa visto de cima.
- As listras de `faixas.js` saem só dentro das peças de cruzamento (até a borda delas, mais 2 m), que trazem as suas. No cruzamento torto, sem peça, elas continuam, 5 cm acima do asfalto, por cima da fita. A lista das faixas fica inteira, para os pedestres e os semáforos.
- Sem o arquivo em `.local/rouds/`, ou com `?kit=0`, nada muda.

**PREMISSAS:** ângulo reto até 20° fora; 4 faixas acima de 12 m; escala da largura entre 0,6 e 1,6; peças 3 cm acima do OSM.

**Testado** em 2026-11-28:
- no Node, com o grafo das ruas de teste:
  - + de 8 m: `cruz2` (escala 1,04) e 76 retas; + de 16 m: `cruz4` e retas de 4 faixas;
  - T de 8 m: o cruzamento com a calçada no braço que falta; L e X a 45°: retas e asfalto nas dobras, sem cruzamento;
  - em todos, nenhuma reta dentro da peça de cruzamento, e todas na rua;
- no navegador:
  - em (-1397, 4857), 136 retas e 9 asfaltos; o T dali não é ângulo reto (braços a 44°, 192° e 292°) e ficou com o asfalto do OSM;
  - com a textura do kit no asfalto do OSM, a junta entre as peças e o OSM sumiu (antes, o OSM era cinza claro);
  - procurando em volta, o grafo achou cruzamentos em ângulo reto, como o de (-2044,6; 4290,9). Ali entraram 2 `cruz2`, 1 T com calçada, 140 retas e 19 asfaltos. Na captura, o cruzamento do kit, com faixas de pedestre e cantos de calçada, recebe a reta com a linha amarela;
  - com `?kit=0`, e com o arquivo tirado de `.local/` (o kit fica `missing`), as ruas voltaram às de hoje, com as listras das faixas;
  - o mapa visto de cima mostra o asfalto do kit nas ruas.

**Limites desta versão:**
- (resolvido) o grafo levava cerca de 140 ms na cidade e era refeito a cada 60 m, com um engasgo. Quase tudo era o afinamento, que montava um vetor de vizinhos por célula. Reescrito sem alocar e só revisitando as células vivas, o esqueleto caiu de cerca de 60 ms para 1 ms, e o grafo inteiro, no jogo, para 10 a 26 ms em 4 lugares da cidade. O esqueleto e o grafo saem iguais aos de antes nas 4 formas de rua de teste. Um worker não foi preciso;
- (resolvido) a linha amarela quebrava nas dobras do trecho, com as retas em fileira. Com a fita contínua, ela segue inteira e só vira no canto que o grafo tem (simplificado a 1 m). A fita também encosta na peça de cruzamento sem a junta escura que a fileira deixava. Em (-1397, 4857), as ruas passaram de 136 retas e 9 asfaltos para 30 triângulos de fita; no cruzamento de (-2044,6; 4290,9), 2 `cruz2`, 1 T e 54 triângulos. No Node, o chanfro de uma fita de 8 m no canto em L põe as bordas a 5,66 m do canto (4·√2), todos os triângulos ficam virados para cima, e o v cresce com a distância;
- o cruzamento que não é em ângulo reto fica com o asfalto do OSM, sem faixa de pedestre do kit. (Resolvido em parte: ali voltaram as listras de `faixas.js`. No T torto de (-1397, 4857), as 3 faixas desenham 27 listras por cima da fita. No cruzamento reto de (-2044,6; 4290,9), as 4 faixas ficam dentro das peças do kit, e nenhuma listra a mais aparece);
- as curvas do kit ainda não entram.

**Testado (as peças)** em 2026-11-28: as 8 peças lado a lado, de cima, com a textura do kit no lugar certo (a faixa amarela, as faixas de pedestre, o "STOP", o piso da calçada). O cruzamento de 2 faixas saiu inteiro depois de juntar os braços. O teste da ferramenta (`tests/roadKit.test.js`) cobre a normalização, o UV e as peças.

## Avatar e animações: Universal Animation Library (Quaternius)

Análise do pacote [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html), página lida em 2026-11-21:

| Item | O que diz a página | Para o SCC |
|---|---|---|
| Licença | **CC0** (domínio público): uso pessoal, educacional e comercial, sem atribuição | Pode entrar no jogo e no SCC Kit ([ADR-0015](../adr/0015-render-realista-e-biblioteca-3d.md)). Ao contrário da Evermotion e da Relebook, também pode ser redistribuída |
| Versões | Standard e Pro gratuitas; Source paga (Patreon), com `.blend` e implementação em Unity, Unreal e Godot | Basta a Pro. O `.blend` só seria útil para editar os clipes |
| Conteúdo | 120+ animações: locomoção em 8 direções, trote, corrida, empurrar, rastejar, nadar, sentar, morte, combate, armas e emotes | Cobre a rua (idle, andar, correr) e parte do interior (sentar). A página não cita "digitar", "abrir porta" nem "conversar". Conferir no Animation Viewer do pacote antes do escritório |
| Formatos | FBX e glTF/GLB (a página também cita OBJ e Blend) | O GLB entra direto no three.js, sem conversão |
| Esqueleto | Rig humanoide universal, pronto para retarget; testado em Godot, Unity e Unreal | No three.js, os clipes funcionam direto num personagem com os mesmos nomes de ossos. Para os avatares próprios do jogo, use esse mesmo rig ou faça o retarget no Blender antes de exportar |

**Recomendação:** adotar a Universal Animation Library como biblioteca de movimento dos avatares. Ela é CC0, gratuita, traz o GLB e tem um rig único para todos os personagens. Adotada em 2026-11-21 (abaixo). Para os avatares próprios do jogo, siga uma regra: todo modelo de avatar é entregue no rig universal. Assim, um único arquivo de animações serve para todos os personagens.

### Os manequins do jogo: Man e Woman

Desde 2026-11-21, o avatar do street view, do interior e dos outros jogadores é o manequim da UAL. O jogador escolhe o tipo na barra do street view ("Avatar: Man | Woman"). A escolha fica no navegador e vai para os outros jogadores pelo `realtime` (campo `skin`).

| Tipo | Modelo | Clipes |
|---|---|---|
| **Man** | Manequim masculino do `UAL1_Standard.glb` | Os 9 clipes do jogo, dentro do próprio arquivo |
| **Woman** | Manequim feminino (`Mannequin_F.glb`, da pasta `UAL-Woman`) | Os mesmos clipes do Man: os dois manequins têm o mesmo esqueleto de 65 ossos e os mesmos nomes |

A pasta `UAL-Woman` traz a biblioteca de animações vol. 2 (`UAL2_Standard.glb`), com o mesmo manequim masculino e outras ações: telefone, plantio, carregar caixa, sim/não e outras. Ela não tem as animações de andar, então serve para ações futuras.

**Clipes do jogo** (vol. 1, versão sem root motion, porque quem move o avatar é o jogo):

| Uso | Clipes |
|---|---|
| Rua | `Idle_Loop` (parado), `Walk_Loop` (andar), `Jog_Fwd_Loop` (Shift) e `Sprint_Loop` |
| Interior | `Sitting_Enter`, `Sitting_Idle_Loop`, `Sitting_Exit`, `Interact` e `Idle_Talking_Loop` |

**Pacote:** `tools/scc-builder/bin/avatar-pack.js` lê as pastas `UAL-Man` e `UAL-Woman`. Ele deixa só esses clipes, comprime com meshopt e grava em `docs/proposta-cidade-realista/assets/avatar/`:

| Arquivo | Original | Pacote |
|---|---|---|
| `avatar-man.glb` | 7,4 MB | 3,1 MB |
| `avatar-woman.glb` | 1,4 MB | 0,3 MB |

A licença vai junto, em `LICENSE-UAL.txt`. As pastas originais ficam fora do repositório. Para refazer o pacote:

```
cd tools/scc-builder
node bin/avatar-pack.js ../../../UAL-Man ../../../UAL-Woman ../../docs/proposta-cidade-realista/assets/avatar
```

O código compartilhado fica em `docs/proposta-cidade-realista/avatar.js`: os tipos, a escolha, a carga, a instância por jogador (`SkeletonUtils.clone`) e os clipes por papel. Se os arquivos não carregarem, o avatar volta a ser o RobotExpressive (CC0).

**Testado** em 2026-11-21 no navegador:
- o Man andou pela rua de costas para a câmera, na direção do movimento;
- a troca para Woman aconteceu na hora, com o idle tocando;
- a escolha ficou salva, e o interior da residência abriu com a Woman;
- o `realtime` aceita `skin` `man` e `woman` (e trata o antigo `human` como `woman`) e ignora outro valor, coberto por teste.

## Entrar nos imóveis

No street view, clique no lote de uma residência ou de um escritório perto do avatar, a até 45 m. O clique no recuo entre a rua e o lote vale para o lote mais perto, a até 8 m. O world confere se o jogador é o dono ou um convidado ([regras](../../services/world/README.md#visitas-entrar-nos-imóveis-pelo-street-view)). Se for, abre o interior:

- `escritorio.html?tipo=home|office&titulo=…&voltar=pittsburg.html?rua=x,z,rumo`;
- o mesmo spike do escritório ([ADR-0015](../adr/0015-render-realista-e-biblioteca-3d.md)), com luz assada e o mesmo avatar;
- a residência tem estar com TV, cozinha, mesa de jantar e quarto;
- o avatar chega já dentro, junto à porta;
- sair pela porta, ou pelo botão "Sair para a rua", volta o avatar à mesma rua e com o mesmo rumo;
- o endereço de volta só aceita `pittsburg.html`, então o link não redireciona para fora.

Na ficha do lote, o dono vê o botão "Entrar", a lista de convidados e o campo para convidar pela carteira. No painel "Jogo no servidor", a seção "Convites" lista onde o jogador foi convidado, com "Ir até lá", que põe o avatar na rua mais perto do lote.

**Testado** em 2026-11-21, no navegador e com os serviços locais:
- o jogador comprou um lote e construiu a Casa T1. Para não esperar as 24 h de obra, o fim da obra foi adiantado só no banco local;
- "Entrar", na ficha, abriu a residência;
- "Sair para a rua" voltou à mesma rua, no street view;
- o clique no lote, no street view, abriu a residência;
- o clique no lote vizinho, sem imóvel, mostrou o aviso.

As regras de convite estão cobertas pelos testes do world.

### Sentar e interagir no interior

Com o avatar dentro da residência ou do escritório:

| Item | Onde | Clipe |
|---|---|---|
| Sentar | Cadeiras da mesa de jantar, das estações e da sala de reunião; os três lugares do sofá; a beira da cama. O avatar fica no assento, de costas para o encosto | `Sitting_Enter`, depois `Sitting_Idle_Loop`; ao levantar, `Sitting_Exit` e volta ao lugar livre de onde veio |
| Interagir | TV (liga e desliga a tela), cozinha, estante e recepção do escritório | `Interact`, uma vez, com um aviso na tela |
| Conversar | Botão "💬 Conversar" | `Idle_Talking_Loop` até o avatar se mexer |

Como usar:
- clique no assento ou no objeto: o avatar vai até ele e age quando chega a até 1,6 m;
- perto de um item, o botão no rodapé mostra a ação, por exemplo "E · Sentar no sofá", e a tecla E faz a ação;
- qualquer movimento levanta o avatar ou encerra a ação.

**Testado** em 2026-11-21 no navegador:
- na residência, o avatar sentou no sofá e na cadeira da mesa de jantar, de frente para a mesa, e levantou de volta ao lugar livre;
- a TV ligou, com o clipe Interact, e voltou ao idle;
- no escritório, sentou na cadeira da estação;
- "Conversar" tocou o clipe de conversa e parou ao andar.

### Visitas com outros jogadores

Quem está no mesmo imóvel, o dono e os convidados, se vê dentro dele. Cada pessoa aparece com:
- o tipo de avatar (Man ou Woman);
- o nome, com "(dono)" para quem é dono;
- a pose: andando, correndo, sentada, interagindo ou conversando.

O painel "💬 Aqui dentro" mostra quantas pessoas estão no imóvel e tem um chat, com a mesma moderação do bairro.

- **Sala:** `interior` no `realtime`, uma por lote (`city`, `lot`), até 25 pessoas.
- **Quem entra:** o `realtime` pergunta ao world, com o token do próprio jogador, se ele pode visitar o imóvel do lote (`/visit`). É a mesma regra do clique no street view, sem segredo novo. Quem não é dono nem convidado não entra na sala.
- **O que vai para a sala:** a posição, o rumo, a pose e o tipo de avatar, até 6 vezes por segundo e só quando algo muda.
- **Como os outros aparecem:** quem senta vai direto ao assento, tocando `Sitting_Enter` e depois `Sitting_Idle_Loop`. Ao levantar, toca `Sitting_Exit`. O mapa passa o número do lote e o nome do jogador ao interior.

**Testado** em 2026-11-21, com duas abas no mesmo imóvel e os serviços locais:
- o world autorizou as duas entradas;
- A viu B (Woman, dona) entrar e sentar no sofá;
- a mensagem de B chegou a A pelo chat.

A recusa para quem não foi convidado está coberta pelo teste do `realtime`.

## Outros jogadores na rua (multiplayer)

A sala do bairro no `realtime` sincroniza, para cada jogador:
- a posição;
- o rumo;
- o modo: `map`, olhando o mapa de cima, ou `street`, caminhando;
- a velocidade, até 10 m/s.

No street view, a posição é a do avatar, e o cliente manda até 5 atualizações por segundo, só quando algo muda. Na rua, o bairro da sala é o do lote mais perto, a até 40 m.

| Eu estou | Vejo os outros |
|---|---|
| No mapa | Todos como alfinete com o nome |
| No street view | Quem também está na rua como avatar, com o mesmo modelo, o nome em cima e a animação pela velocidade (parado, andando, correndo). Quem está no mapa não aparece na rua |

O avatar dos outros segue a posição recebida na velocidade de caminhada, sem pular a cada mensagem. Se a distância passa de 30 m, ele salta direto para a posição.

**Testado** em 2026-11-21, com dois jogadores em duas abas e o `realtime` local:
- B, na rua, apareceu como avatar para A, com o nome e a 3,2 m;
- A voltou ao mapa e viu B como alfinete;
- B voltou ao mapa e saiu da rua de A.

## Próximos passos

1. Colisão da câmera com os prédios, e faixas de pedestre e calçadas como área preferida.
2. Interiores próprios para cada tipo de imóvel e de negócio, e o modelo do prédio aprovado no lugar do escritório padrão.
3. Digitar no computador sentado: a UAL vol. 1 não tem esse clipe; a vol. 2 tem ações de mão que podem servir.

**Próximo passo:** o mobiliário urbano, o céu por hora e a cidade viva estão em [mundo aberto em terceira pessoa](mundo-aberto-terceira-pessoa.md).
