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

**Limites desta versão:** o carro não vira à esquerda e não há preferência no cruzamento sem semáforo. O carro já para para o pedestre que atravessa na faixa ([travessia](#travessia-na-faixa)) e no semáforo ([semáforos](#semáforos-nos-cruzamentos-fase-3)). Os sons ficam para os próximos passos.

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

**Limites desta versão:** o avatar ainda não embarca (o deslocamento de ônibus do jogo, 6 min e 3 THALER, é só a regra do turno), e o ônibus não segue uma linha fixa.

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
