# Trilha — Site institucional

Pasta: [`website/`](../../website/README.md) · Especificação: [doc 12](../12-site-institucional.md) · Telas do jogo: [docs/telas](../telas/README.md)

## Caminho de desenvolvimento

| Passo | Etapa | O que fazer | Estado |
|------:|-------|-------------|--------|
| 1 | 0 | Site em PHP e JS com home, tutorial, marketplace, venda privada, conta e 404, no visual do kit de marca | Feito |
| 2 | 0 | APIs `stats`, `listings` e `contact` com dados de exemplo e fallback | Feito |
| 3 | 0 | Carteira EIP-1193 (conectar, rede BSC, saldos, adicionar token, assinatura) | Feito |
| 4 | 1 | Preencher equipe, redes sociais, trailer; páginas de termos e privacidade | A fazer |
| 5 | 1 | Contato por e-mail (SendGrid) em vez do arquivo `storage/contact.jsonl` | A fazer |
| 6 | 2 | Rota pública `GET /v1/public/stats` no gateway e `SCC_GAME_API_URL` em staging | A fazer |
| 7 | 2 | Login real: SIWE pelo gateway e card do jogador com dados do avatar | A fazer |
| 8 | 3 | Marketplace on-chain: listar e comprar via contrato `Marketplace` | A fazer |
| 9 | 4 | Contrato SCITY na mainnet: `SCC_TOKEN_ADDRESS`, `SCC_CHAIN_ID=56`, link do par na PancakeSwap | A fazer |
| 10 | 4 | Venda privada (só com parecer jurídico): contrato auditado, aprovação de BUSD, compra | A fazer |
| 11 | 5 | i18n (EN/ES), blog/novidades, página de eventos | A fazer |

## Regras
- Sem dependências de build: CSS e JS são servidos como estão. Se um dia precisar de bundler, registre num ADR.
- Conteúdo editável em `src/data/`. Lógica fora de `public/`.
- Todo dado vindo de fora passa por `e()` no PHP e por `textContent` no JS (nunca `innerHTML` com dado externo).
- Nenhum segredo em `public_js_config()`.
- Antes do PR: rode `php -l` nos arquivos alterados e teste em 1440 px e 375 px.
