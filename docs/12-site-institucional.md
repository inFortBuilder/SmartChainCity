# 12 — Site Institucional

Especificação do site público da Smart Chain City. O código está em [`website/`](../website/README.md): PHP e JavaScript, sem WordPress.

## 1. Origem

| Fonte | Local | O que foi aproveitado |
|-------|-------|-----------------------|
| Site WordPress + Elementor (backup Duplicator, jan/2023) | `C:\SmartChainCity\site\SmartChaiCity` | Estrutura do menu, SVGs do cenário (skyline com guindaste, grama do rodapé, moldura do vídeo, botões de plataforma, PIX) |
| Briefing *Site (Home)* e *Site (Internas)* | `site\SMART CHAIN CITY-…-001.zip › site\` | Seções 1–6 da home e páginas internas (Venda privada, Marketplace, Tutorial, Conta) |
| Layouts **PLAY NOW** e **TUTORIAL** | `…\site\SITE\*.png` | Diagramação da home e do tutorial |
| Kit de marca (`_SAÍDA`) | mesmo zip | Logo vetorial, moeda 3D, tipografia (Londrina Solid, Baloo 2), HUD, cards de inventário |

O site antigo dependia de WordPress 5.9 com Elementor Pro e muitos plugins, e o backup inclui banco de dados com dados de usuários. O novo site não tem banco: o conteúdo editável fica em arquivos PHP de dados, e as estatísticas vêm da API do jogo.

## 2. Mapa do site

```
Home (/)
├─ #roadmap ─ #trailer ─ #equipe ─ #parceiros ─ #contato-form
├─ Whitepaper (externo, GitBook)
├─ Marketplace (/marketplace?c=…)
├─ Tutorial (/tutorial)
├─ Minha conta (/account)  ← também pelo botão da moeda no menu e por "Play Now"
└─ Venda privada (/private-sale)  ← rodapé (página interna do briefing)
```

## 3. Home — seções do briefing × implementação

| Seção do briefing | O que pede | Implementação |
|-------------------|-----------|---------------|
| 1 — Primeira dobra | Imagem impactante com logo, cidade; ícones Android, iOS e PC (só PC ativo); contrato com clicar-e-copiar; botão **Trade Now** para a PancakeSwap; menu Home, Whitepaper, Roadmap, Team, Partners, Marketplace, Tutorial (moeda) e Play Now; texto curto de apresentação | Hero no layout PLAY NOW: logo, botões redondos de pedra (Play Now, Conta, Depósito), painel de pedra com Avatares, Lotes, Impostos e Acidentes de trabalho; selos de plataforma (PC colorido, Android e iOS em cinza); faixa do contrato com **Copiar** e **Trade Now**; skyline com guindaste |
| 2 — Roadmap | Evolução do desenvolvimento | Placas amarelas de trânsito (E0–E5) com as etapas do [ROADMAP](../ROADMAP.md). O roadmap Q1–Q4 2022 do briefing está desatualizado e foi substituído |
| 3 — Trailer | Vídeo oficial com fundo temático | Moldura de madeira com plantas (`video-frame.webp`); o iframe só carrega no clique |
| 4 — Equipe | Foto, nome e cargo em cards no estilo dos avatares | Cards no estilo do HUD do jogador, com a cor pela raridade |
| 5 — Parceiros | Logos todos da mesma cor | Logos em branco monocromático (FGV Jr., BNB Smart Chain) |
| 6 — Rodapé | Logo menor, links, suporte, audit report, ícones das comunidades | Grama ilustrada, links, placa de madeira com as redes, colunas Parcerias e Suporte, aviso legal |
| (novo) | — | "Viva a cidade" (4 recursos com ícones do HUD e o card de imóvel T1) e formulário de contato |

## 4. Páginas internas

| Página | Briefing | Implementação |
|--------|----------|---------------|
| Venda privada | Valor do token, mínimo e máximo, barra de porcentagem até o hard cap | Painel de pedra com fatos, barra de progresso no estilo do *claim* do jogo, calculadora de tokens. O botão fica **desativado** até `SCC_SALE_OPEN=true`, com aviso de risco (ver [doc 10 §3](10-seguranca-compliance.md#3-riscos-regulatórios-brasil--validar-com-assessoria-jurídica)) |
| Marketplace | Compra e venda de itens e NFTs | Janela no estilo do inventário (abas, faixa verde com silhueta de cidade, cards INVENTÁRIO 03 com Nível, Rendimento, Desgaste, Local e ROI), filtros sem recarregar a página, busca, ordenação e modal de compra |
| Tutorial | Vídeo mostrando o jogo (referência: Mafagafo) | Layout TUTORIAL: título, vídeo, Trade Now, 9 placas de madeira "Veja como comprar" e "Compre também com PIX" |
| Conta | Página da conta do usuário | Card do jogador (HUD superior), conexão da carteira, saldos, adicionar SCITY à carteira, assinatura de posse, depósito (em breve) |

## 5. Identidade visual (tokens do `style.css`)

| Token | Cor | Uso |
|-------|-----|-----|
| `--sky-top` / `--sky-bottom` | `#6ec3f2` → `#e3f5ff` | Céu das primeiras dobras |
| `--navy` | `#0b4f7a` | Textos sobre o céu, títulos |
| `--green` / `--green-dark` | `#8ddc0e` / `#275e12` | Botões de ação, janelas do jogo, Play Now |
| `--blue` / `--blue-dark` | `#2a7ae4` / `#1442a8` | HUD do avatar, ROI, ações secundárias |
| `--stone*` | `#a9a9a9`, `#d9d9d9`, `#6c6c6c` | Menu e painéis de pedra |
| `--wood*` | `#b0492a`, `#d0683c`, `#6d2a14` | Placas, Trade Now, rodapé social |
| `--yellow` | `#f8c513` | Placas do roadmap, item ativo do menu, foco |
| `--field` | `#2f8a24` | Seções de "campo" (trailer, tutorial, equipe) |

Tipografia: **Londrina Solid Black** em títulos, menu e botões; **Baloo 2** no texto. Os arquivos vêm do kit de marca e são licenciados sob OFL.
Raridades nos cards: Comum (verde), Raro (azul), Épico (roxo) e Lendário (dourado), as mesmas do jogo e das telas.

## 6. Comportamento (JavaScript)

| Script | Responsabilidade |
|--------|------------------|
| `main.js` | Menu mobile, copiar contrato, contadores animados, revelação ao rolar (respeita `prefers-reduced-motion`), atualização das estatísticas a cada 60 s, vídeo sob demanda, envio do contato por `fetch` |
| `wallet.js` | Carteira EIP-1193: conectar, trocar ou adicionar a rede BSC, saldos, `wallet_watchAsset`, `personal_sign`, reconexão silenciosa |
| `account.js` | Estados conectado/desconectado da conta e barras do HUD |
| `marketplace.js` | Troca de aba via HTML renderizado no servidor (sem duplicar o template no JS), busca, ordenação, modal de compra |
| `sale.js` | Calculadora e validação de mínimo e máximo da venda |

Sem JavaScript, o site continua navegável: as abas do marketplace são links, os números aparecem já renderizados e o formulário tem `action` e `method`.

## 7. Acessibilidade, SEO e desempenho

- Link "Pular para o conteúdo", `aria-current` no menu, `aria-label` nos ícones, foco visível amarelo, contraste alto nos botões.
- `<title>` e `meta description` por página, Open Graph com a moeda 3D.
- Imagens com `loading="lazy"`, fontes com `font-display: swap`, cache longo com *cache busting*. Os assets somam cerca de 2,7 MB, quase tudo fontes e a moeda 3D.
- Responsivo em 3 faixas (> 1100 px, ≤ 900 px, ≤ 600 px), testado em 1440 × 900 e 375 × 812 sem rolagem horizontal.

## 8. Integração com a plataforma

| Ponto | Hoje | Quando o backend existir |
|-------|------|--------------------------|
| Estatísticas da home | `src/data/stats.php` | `GET {SCC_GAME_API_URL}/v1/public/stats` (rota nova no gateway) |
| Anúncios do marketplace | `src/data/listings.php` | `GET /v1/market/listings` ([doc 06](06-modelo-dados-api.md)) |
| Login / conta | Assinatura local de demonstração | SIWE no gateway → JWT → dados do avatar |
| Compra no marketplace | Modal sem transação | `Marketplace.buy()` ([doc 07 §2.5](07-smart-contracts.md#25-marketplace)) |
| Depósito | Desativado | `GameVault.deposit()` ([doc 07 §2.4](07-smart-contracts.md#24-gamevault)) |
| Play Now | `/account.php` | URL do cliente WebGL no CDN |
