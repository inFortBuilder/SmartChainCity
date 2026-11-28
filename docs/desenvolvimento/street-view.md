# Street view: caminhar pelas ruas da cidade

Na cidade real (`docs/proposta-cidade-realista/pittsburg.html`), o jogador arrasta o boneco do canto inferior direito até uma rua, como no Street View do Google. Durante o arrasto, as ruas ficam azuis e o marcador no chão fica verde sobre a rua e vermelho fora dela. Ao soltar numa rua, a câmera desce ao nível do chão, atrás do avatar, e ele caminha **só pelas ruas**.

| Comando | O que faz |
|---|---|
| W A S D ou setas | Anda; para a frente é para onde a câmera olha |
| Shift | Corre |
| Clique ou toque na rua | Caminha até o ponto em linha reta e para na borda da rua, se ela acabar no caminho |
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

**Limites desta versão:**
- A câmera em terceira pessoa ainda não colide com prédios. Em Pittsburg, que ainda não tem prédios, isso não aparece.
- As calçadas e as faixas de pedestre só existem onde o OSM as desenha como `highway`.
- O avatar ainda não aparece para os outros jogadores (multiplayer, E2.7).

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

**Próximo passo:** a câmera com colisão, as calçadas caminháveis e a cidade viva estão em [mundo aberto em terceira pessoa](mundo-aberto-terceira-pessoa.md).
