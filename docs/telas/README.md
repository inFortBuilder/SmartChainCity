# Telas do Jogo — modelos

Wireframes de alta fidelidade das principais telas do cliente Unity WebGL, em **SVG 1920 × 1080**. Eles seguem os layouts do kit de marca e do build legado:

- **LayoutHUD.png** (`_ENTRADA _ ANOTAÇÕES/Barra e ícones`): diagramação do HUD, com menu lateral (Mundos, Mapa, Email), Eventos, menus radiais Patrimônio e Avatar (aberto e fechado), saldo com Exchange e regra "HUD genérica, sem elementos do ambiente";
- **HUB SUPERIOR.png** e apresentações do HUD: card do jogador com nível e as 4 barras (saúde, felicidade, alimentação, energia), botões redondos verdes e azuis;
- **INVENTÁRIO 02/03.png**: janela verde com abas Inventário/Shop, silhueta de cidade e card de imóvel (Nível, Rendimento, Desgaste, Localização, ROI, barra TLR e **Claim**);
- **Build 0.0.23**: cenas `ShowcaseLogin`, `ShowcaseSelectAvatar`, `SelectWorlds`, `ShowcaseCity`.

**Ver as telas:** abra [`index.html`](index.html) por um servidor local, para as fontes da marca carregarem. Na raiz do repositório:

```bash
php -S localhost:8081 -t .
```

Depois acesse http://localhost:8081/docs/telas/index.html. Abertos direto (ou no GitHub), os SVGs aparecem com fontes substitutas.

## Telas

| # | Arquivo | Cena Unity | Conteúdo | Dados (API, doc 06) |
|---|---------|-----------|----------|---------------------|
| 01 | [01-login.svg](01-login.svg) | `Login` (ShowcaseLogin) | Logo, painel de pedra com **Conectar MetaMask** e **Entrar com e-mail**, versão e ajuda | `POST /v1/auth/siwe/*`, `/v1/auth/email/login` |
| 02 | [02-lucky-box.svg](02-lucky-box.svg) | `SelectAvatar` | 4 caixas por raridade (preço e chances), "Seus smartcityanos (2/3)", detalhe do avatar e botões Jogar / Ver no market | `GET /v1/avatars`, contrato `LuckyBox` |
| 03 | [03-cidade-hud.svg](03-cidade-hud.svg) | `City` | Cidade isométrica com ruas a cada 4 lotes, HUD superior, saldo THALER + Exchange, indicador "A1 · Bairro · Célula · Estação", menu lateral, Eventos, menus radiais **Patrimônio** (Imóveis, Empresas, Lotes, Carros) e **Avatar** (Alimentação, Educação, Emprego, Roupas, Pet), widget do turno em andamento, balão **Claim** sobre um imóvel | `GET /v1/me`, `/v1/world/cells/:cx/:cy`, WebSocket da célula |
| 04 | [04-inventario.svg](04-inventario.svg) | janela sobre `City` | Inventário de imóveis: T1 e T2 rendendo, R3 em obra, lote vazio com aviso de PT e botões Construir/Vender; total a coletar | `GET /v1/properties`, `POST /v1/properties/:id/claim` |
| 05 | [05-mapa-lotes.svg](05-mapa-lotes.svg) | modo Mapa | Grade da célula (livre, residencial, comercial, rua, selecionado), navegação Região › Bairro › Célula › Lote, painel com zona, distância, água/energia, vizinhos, PT, preço da Prefeitura e verificação das regras (1 bairro por região, sem cercar) | `GET /v1/lots/:x/:y`, `POST /v1/lots/:x/:y/quote`, `LandNFT.buyPrimary` |
| 06 | [06-turno-trabalho.svg](06-turno-trabalho.svg) | janela sobre `City` | Escolha de turno (2 × 6 h ou 12 h), deslocamento (carro, skate, a pé), multiplicadores, tarefas do minigame (concluídas, em andamento, dano, pendentes), progresso e **Claim** | `POST /v1/avatars/:id/work`, `/claim`, evento WS `shift_done` |
| 07 | [07-marketplace.svg](07-marketplace.svg) | janela sobre `City` | Aba Market entre Inventário e Shop; filtros, busca, ofertas de jogadores (imóveis, lote, avatar, item), leilão de imóvel raro, taxas | `GET /v1/market/listings`, contrato `Marketplace` |
| 08 | [08-exchange.svg](08-exchange.svg) | janela sobre `City` | Saque THALER → SCITY e depósito; câmbio TWAP, spread, limite diário, carência de conta nova, voucher EIP-712 | `GET /v1/economy/fx`, `POST /v1/economy/withdrawals`, `GameVault.claim` |

## Regras de UI que as telas fixam

1. **HUD genérica:** HUD superior, saldo e menus radiais aparecem iguais em qualquer mapa (cidade, fazenda, outros mundos), como pede o LayoutHUD.
2. **Menus radiais:** fechados mostram só os dois botões grandes (Patrimônio verde e Avatar azul); abertos mostram os filhos em arco com rótulo.
3. **Janelas** (inventário, market, turno, exchange) escurecem a cidade em 55% e têm abas no topo e botão fechar no canto.
4. **Raridade = cor:** Comum verde, Raro azul, Épico roxo, Lendário dourado, em cards, caixas e badges.
5. **Valores de atributo:** a UI mostra direção (+/−) e valores aproximados. O ganho exato de cada atividade não é divulgado (regra da planilha econômica, [doc 02 §2.4](../02-game-design.md#24-multiplicadores-tabela-de-atributos)).
6. **Ações com dinheiro real** (comprar lote, sacar) sempre mostram preço, taxas e limites antes da confirmação na carteira.
7. **Moedas:** THALER usa a moeda dourada com "$" do kit; SCITY usa o ícone amarelo da BNB Chain com "S".

## Como editar

As telas foram montadas a partir de fragmentos: `defs` (gradientes, ícones e moedas), HUD superior e cidade isométrica gerada por script. Para alterar, edite o SVG direto. Os blocos estão comentados (`<!-- HUD superior … -->`, `<!-- Menu radial … -->`). Para produção, a arte final vem das peças do kit em [`art/hud/`](../../art/hud) e da arte 3D do projeto Unity.
