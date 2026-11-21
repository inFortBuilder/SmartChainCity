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

**Recomendação:** adotar a Universal Animation Library como biblioteca de movimento dos avatares. Ela é CC0, gratuita, traz o GLB e tem um rig único para todos os personagens. Para os avatares próprios do jogo, siga uma regra: todo modelo de avatar é entregue no rig universal. Assim, um único arquivo de animações serve para todos os personagens.

### Como ligar no MVP local

O pacote não vai para o repositório: o arquivo é grande, e o pacote não foi baixado nesta sessão.

1. Baixe a versão Standard ou Pro na página do pacote.
2. Coloque dois GLB em `.local/animacoes/ual/`:
   - `personagem.glb`: o manequim ou o avatar no rig universal;
   - `animacoes.glb`: os clipes.
3. Recarregue o mapa. O street view tenta esses arquivos primeiro e, se não os encontra, usa o RobotExpressive (Quaternius, CC0) do repositório do three.js. A origem fica em `window.__pittsburg.streetView.avatar.source`.

Os clipes são escolhidos pelo nome: `idle`; `walk`/`walking` (sem "back"); e `run`/`jog`/`sprint`.

## Próximos passos

1. **Entrar nos imóveis:** clicar num escritório ou numa residência do jogador, ou de quem o convidou, abre o interior, que é o spike do escritório ([ADR-0015](../adr/0015-render-realista-e-biblioteca-3d.md)), com o mesmo avatar e as mesmas animações. Para isso, falta a regra de convite no world.
2. Posição do avatar no multiplayer do bairro (`realtime`).
3. Colisão da câmera com os prédios, e faixas de pedestre e calçadas como área preferida.
4. Animações de interior da UAL (sentar e, se houver, digitar) no escritório.
