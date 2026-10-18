# website — Site institucional Smart Chain City

Site em **PHP 8.1+ e JavaScript puro** (sem framework e sem build), substituto do antigo site em WordPress/Elementor (`C:\SmartChainCity\site`).
O visual segue o kit de marca da agência (menu de pedra, painéis de pedra, placas de madeira, céu e skyline) e os layouts **PLAY NOW** e **TUTORIAL**.

- Especificação (mapa do site, seções, identidade visual): [docs/12-site-institucional.md](../docs/12-site-institucional.md)
- Caminho de desenvolvimento: [docs/desenvolvimento/trilha-site.md](../docs/desenvolvimento/trilha-site.md)

## Páginas

| URL | Arquivo | Conteúdo |
|-----|---------|----------|
| `/` | `public/index.php` | Hero "Play Now" (logo, botões redondos Play/Conta/Depósito, painel de estatísticas), contrato + Trade Now, Roadmap, Trailer, "Viva a cidade", Equipe, Parceiros, Contato |
| `/tutorial` | `public/tutorial.php` | "Na cidade que nunca dorme…", vídeo, Trade Now, 9 placas "Veja como comprar", PIX |
| `/marketplace` | `public/marketplace.php` | Janela no estilo do inventário do jogo; abas Imóveis/Lotes/Avatares/Itens, busca, ordenação, modal de compra |
| `/private-sale` | `public/private-sale.php` | Preço do token, mínimo/máximo, barra de hard cap, calculadora, aviso de risco |
| `/account` | `public/account.php` | Card do jogador (HUD), conexão MetaMask, saldos BNB/SCITY, adicionar token, assinatura de posse, depósito (em breve) |
| qualquer outra | `public/404.php` | "Rua sem saída!" |

## API JSON

| Método | Rota | Resposta |
|--------|------|----------|
| GET | `/api/stats.php` | `{avatars, lands, taxes, work_accidents, source}` — painel da home (atualizado a cada 60 s pelo JS) |
| GET | `/api/listings.php?category=all\|property\|land\|avatar\|item` | `{category, items[]}` — 400 se a categoria for inválida |
| POST | `/api/contact.php` | Formulário de contato. Exige `csrf`; honeypot `website`; 1 envio/minuto por sessão; 422 com `fields` em caso de erro de validação |

Quando `SCC_GAME_API_URL` está definida, `stats` e `listings` vêm da API do jogo (`/v1/public/stats`, `/v1/market/listings` — ver [docs/06](../docs/06-modelo-dados-api.md)). Sem ela, ou se a API falhar, o site usa os dados de exemplo em `src/data/` e a home mostra "Dados de demonstração".

## Estrutura

```
website/
├─ public/                 ← raiz do servidor web (document root)
│  ├─ index.php, tutorial.php, marketplace.php, private-sale.php, account.php, 404.php
│  ├─ api/                 ← endpoints JSON
│  ├─ assets/
│  │  ├─ css/style.css     ← todo o visual (tokens em :root)
│  │  ├─ js/               ← main.js (comum), wallet.js (EIP-1193), account.js, marketplace.js, sale.js
│  │  ├─ fonts/            ← Londrina Solid e Baloo 2 (kit de marca, licença OFL)
│  │  └─ img/              ← brand/ (logo 3D oficial e moeda em WebP), hud/ (ícones do jogo), legacy/ (SVGs do site antigo), partners/, icons/
│  ├─ .htaccess            ← Apache: URLs sem .php, cache, segurança
│  └─ router.php           ← roteador do servidor embutido do PHP (dev)
├─ src/                    ← fora do document root
│  ├─ bootstrap.php        ← configuração, sessão, cabeçalhos de segurança
│  ├─ config.php           ← configuração por variáveis de ambiente
│  ├─ lib/                 ← helpers.php (e(), asset(), csrf…), icons.php, GameData.php
│  ├─ partials/            ← head, header (menu de pedra), footer (grama), listing-card
│  └─ data/                ← conteúdo editável: roadmap, team, partners, tutorial, stats, listings
└─ storage/                ← mensagens do contato (contact.jsonl) — não versionado
```

## Rodar localmente

Requisitos: PHP 8.1 ou superior com as extensões `mbstring` e `json` (`openssl` se for chamar a API do jogo por HTTPS).

```bash
php -S localhost:8080 -t website/public website/public/router.php
```

Abra http://localhost:8080. Se o seu PHP não tiver um `php.ini` com o `mbstring` ativo, use:

```bash
php -d extension_dir=ext -d extension=mbstring -S localhost:8080 -t website/public website/public/router.php
```

## Configuração

Todas as opções ficam em `src/config.php` e podem ser definidas por **variável de ambiente** ou por um arquivo `src/config.local.php` (não versionado) que retorna um array parcial.

| Variável | Padrão | Uso |
|----------|--------|-----|
| `SCC_ENV` | `dev` | `dev` mostra erros na tela; `staging`/`prod` não |
| `SCC_BASE_URL` | vazio | Prefixo se o site estiver numa subpasta (ex.: `/site`) |
| `SCC_PLAY_URL` | `/account.php` | Link do botão **Play Now** (URL do cliente WebGL) |
| `SCC_WHITEPAPER_URL` | gitbook | Menu "Whitepaper" |
| `SCC_TRADE_URL` | PancakeSwap | Botões **Trade Now** (use o link do par SCITY quando existir) |
| `SCC_TRAILER_URL` | vazio | URL de *embed* (YouTube/Vimeo, `https://`). Vazio = capa com "em breve" |
| `SCC_DISCORD_URL`, `SCC_INSTAGRAM_URL`, `SCC_TELEGRAM_URL`, `SCC_TWITTER_URL` | `#` | Redes sociais |
| `SCC_SUPPORT_URL`, `SCC_AUDIT_URL` | `#contato`, vazio | Rodapé ("Relatório de auditoria" só aparece se definido) |
| `SCC_CHAIN_ID` | `97` | 97 = BSC Testnet, 56 = BSC Mainnet |
| `SCC_CHAIN_NAME`, `SCC_RPC_URL`, `SCC_EXPLORER_URL` | testnet | Usados ao pedir para a carteira trocar/adicionar a rede |
| `SCC_TOKEN_ADDRESS` | vazio | Contrato SCITY. Vazio = "Endereço publicado no lançamento"; preenchido = botão **Copiar** e leitura de saldo |
| `SCC_SALE_OPEN` | `false` | Habilita o botão da venda privada |
| `SCC_SALE_PRICE_USD`, `SCC_SALE_MIN_USD`, `SCC_SALE_MAX_USD`, `SCC_SALE_HARDCAP_USD`, `SCC_SALE_RAISED_USD` | 0,05 / 50 / 5000 / 350000 / 0 | Dados da venda privada (valores de exemplo) |
| `SCC_GAME_API_URL` | vazio | Base da API do jogo (gateway) para estatísticas e anúncios |

> O endereço de contrato citado no briefing antigo (`0xee8F…dead`) tem só 31 dígitos hexadecimais, ou seja, está incompleto. Por isso o site não o usa: preencha `SCC_TOKEN_ADDRESS` com o endereço real após o deploy.

## Logo e acabamento plástico

**Logo oficial:** é a arte 3D de `C:\SmartChainCity\MKT\logo-novo.jpg`. Ela foi gerada a partir do original em alta resolução com transparência (*Logotipo 3D*, 7311 × 3886, do kit de marca), recortada e reduzida para `img/brand/logo-3d-{260,520,1000}.webp`, com um PNG de 1000 px para o Open Graph. No PHP, use sempre `logo_img($classe, $sizes, $largura)`, que monta o `srcset`.

**Plástico brilhante** (referência: render "Glossy Plastic" do Blender), em duas camadas:

| Onde | Como | Classe / seletor |
|------|------|------------------|
| Imagens e desenhos (logo, moedas, ícones do HUD, selos, PIX) | Filtro SVG `#scc-plastic`: a luminância vira relevo e recebe iluminação especular (`feSpecularLighting`), por isso cada área de cor ganha brilho próprio | `class="plastic"` |
| Ilustrações grandes (skyline, grama do rodapé, moldura do vídeo) | Filtro `#scc-plastic-soft`, mais suave | `class="plastic-soft"`, `.skyline`, `.footer-grass` |
| Componentes (botões, painéis de pedra, cards, placas, abas, badges) | Camada de verniz em `::after` (faixa de reflexo com "horizonte" nítido, ponto especular e base escurecida) sob o texto (`isolation: isolate` + `z-index: -1`), sombras de plástico e cores mais saturadas | variáveis `--gloss-strong`, `--gloss-soft`, `--plastic-shadow` |
| Botões redondos | Esferas com gradiente radial e dois reflexos | `.round-btn` |

Os filtros ficam no início do `<body>` (`src/partials/head.php`). Regras de uso:
- **Não** aplique `plastic` em imagens com texto pequeno (como o card T1): o relevo distorce as letras. Nesses casos, use o verniz do contêiner (ver `.hud-showcase`).
- O verniz some com `prefers-contrast: more`.
- Novos componentes recebem o acabamento quando são incluídos nas listas de seletores do bloco **PLÁSTICO BRILHANTE** do `style.css`.

## Editar conteúdo

| O quê | Onde |
|-------|------|
| Etapas do roadmap | `src/data/roadmap.php` (`status`: `done`, `current` ou `next`) |
| Equipe | `src/data/team.php`. Coloque as fotos em `public/assets/img/team/` e informe o arquivo em `photo` |
| Parceiros | `src/data/partners.php`. Os logos são exibidos em branco, como pede o briefing |
| Passos do tutorial | `src/data/tutorial.php` |
| Números de demonstração | `src/data/stats.php`, `src/data/listings.php` |
| Textos das seções | Direto nos arquivos de `public/*.php` |

## Carteira (wallet.js)

- Sem bibliotecas: usa `window.ethereum` (EIP-1193), compatível com MetaMask, Trust Wallet e outras extensões.
- Troca para a rede configurada (`wallet_switchEthereumChain`) e, se a carteira não tiver a rede, adiciona (`wallet_addEthereumChain`).
- Lê o saldo de BNB (`eth_getBalance`) e de SCITY (`eth_call` com `balanceOf`).
- **Assinatura de posse** (`personal_sign`): só demonstra. A verificação de login de verdade (SIWE, EIP-4361) é feita pelo gateway do jogo ([docs/05 §4](../docs/05-arquitetura-tecnica.md#4-backend)).
- Compras no marketplace e na venda privada **não** executam transações ainda: os contratos não estão publicados. Os pontos de integração estão marcados nos comentários de `marketplace.js` e `sale.js`.

## Segurança e privacidade

- Todo texto vindo de dados passa por `e()` (escape HTML). A configuração exposta ao JS (`public_js_config()`) não tem nenhum segredo.
- Formulário de contato: token CSRF por sessão, honeypot, limite de frequência, validação no servidor e tamanho máximo.
- O IP do remetente não é gravado em claro: só um hash com a sessão (LGPD). As mensagens ficam em `storage/`, fora do document root.
- Cabeçalhos `X-Content-Type-Options`, `Referrer-Policy` e `X-Frame-Options`; cookie de sessão `HttpOnly` e `SameSite=Lax`.
- O rodapé avisa que imóveis do jogo não são imóveis reais e que criptoativos têm risco (ver [docs/10](../docs/10-seguranca-compliance.md)).

## Deploy

Imagens e fontes são versionadas com **Git LFS** (ver `.gitattributes`). No servidor ou no pipeline, rode `git lfs pull` depois do clone; sem isso, os arquivos ficam como ponteiros de texto e as imagens quebram.

**Apache:** aponte o `DocumentRoot` para `website/public`. O `.htaccess` já cuida das URLs sem `.php`, do cache dos assets, da compressão e do bloqueio do `router.php`. Dê permissão de escrita ao usuário do PHP em `website/storage/`.

**Nginx + PHP-FPM:**

```nginx
root /var/www/smartchaincity/website/public;
index index.php;
location / { try_files $uri $uri/ $uri.php?$query_string; }
location = /router.php { return 404; }
location ~ \.php$ { include fastcgi_params; fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name; fastcgi_pass unix:/run/php/php8.3-fpm.sock; }
location ~* \.(css|js|svg|png|jpg|webp|ttf)$ { expires 30d; add_header Cache-Control "public, immutable"; }
error_page 404 /404.php;
```

Os assets têm *cache busting* automático (`?v=<data de modificação>`), então podem ter cache longo.

## Pendências antes de publicar

- [ ] Preencher a equipe (nomes, cargos e fotos com autorização de uso de imagem).
- [ ] Definir as URLs das redes sociais, do suporte e do trailer.
- [ ] Publicar o contrato SCITY e configurar `SCC_TOKEN_ADDRESS` e a rede mainnet.
- [ ] Revisão jurídica dos textos da venda privada e do aviso de risco.
- [ ] Trocar o armazenamento do contato por envio de e-mail (SendGrid já é usado no backend) ou por um CRM.
- [ ] Política de privacidade e termos de uso (páginas novas).
