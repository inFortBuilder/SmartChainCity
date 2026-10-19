# SCC Builder — contexto do projeto

Conversor 3D arquitetônico e validador de prédios da **Smart Chain City**:
editor Web 3D (Vite + Three.js), CLI de conversão com o preset `scc`, API REST
PHP com fila e SQLite, `validate-lot` e SDK PHP. Derivado do Convert3D v2.8.0,
independente dele em tempo de execução ([doc 13 §5](../../docs/13-cidade-realista-construtores.md)).

> **O estado da ferramenta é declarado no `README.md`, e só lá.** Não
> repetir aqui. O `AUDITORIA.md` é histórico do Convert3D, não estado.

**O desenho está no `README.md`** (o que funciona hoje, formatos, API,
estrutura) e em `docs/` (deploy, validação, integração, exportação).

---

## Regras que não se reabre sem motivo

| Regra                                                                               | Por quê                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nenhum vínculo com outra aplicação**                                              | Identidade só pelo JWT do gateway SCC; armazenamento só no bucket SCC; nada lido de arquivo, sessão ou `vendor/` de fora (doc 13 §5.2)                                                                                           |
| **Não tocar o banco de outro serviço**                                              | SQLite próprio; o World chama a API e guarda só o resultado validado                                                                                                                                                             |
| "O que funciona hoje" no README é **só o implementado e testado**                   | A v1 do Convert3D listava IFC e 3MF sem loader: o upload era aceito e a conversão falhava. Promessa não entra na tabela                                                                                                          |
| **JWT HS256 fixo** no servidor; `exp` obrigatório; `sub` = `account_id`             | Aceitar o `alg` do token é a falha clássica do JWT. O `sub` vira pasta no bucket, por isso só caracteres seguros                                                                                                                 |
| **Escopo dos jobs por `account_id`**                                                | Cada jogador só enxerga os próprios modelos; API key sem `X-Account-Id` só vê os próprios jobs                                                                                                                                   |
| API key, quando usada, comparada com `hash_equals` e **nunca** num build público    | `VITE_API_KEY` vai embutido no JavaScript; é só para desenvolvimento local                                                                                                                                                       |
| Upload validado por **magic bytes**, não só pela extensão                           | Extensão é o que o usuário diz; o conteúdo é o que o servidor recebe                                                                                                                                                             |
| Storage **fora do webroot**; download só por `download.php`                         | Proteção contra path traversal e contra execução de arquivo enviado                                                                                                                                                              |
| As regras do lote (`validate-lot`) seguem o **doc 13 §4**                           | Recuo pelo polígono reduzido exato, gabarito, coeficiente com outorga (não reprova), 300 mil triângulos, escala plausível                                                                                                        |
| Formato proprietário mostra **o passo a passo de exportação** do software de origem | Em vez de erro genérico: `.rvt`, `.skp`, `.max` não têm leitor público                                                                                                                                                           |
| Arestas vivas são preservadas na otimização                                         | Um cubo sai com 24 vértices, não 8                                                                                                                                                                                               |
| `npm run check` e `npm run test:php` passam antes do commit                         | lint com zero warnings, Prettier, Vitest, build; JWT, validate-lot e endpoint por HTTP                                                                                                                                           |
| **Todo texto de tela do editor em português, espanhol e inglês**                    | `t('texto em português', ^1…)` de `src/i18n/`; a chave é o próprio texto; `en.js` e `es.js` ao lado. O teste em `tests/` reprova texto sem tradução. A resposta da API (`error.code`) e o log ficam como estão: quem lê é o jogo |

## Convenções

- Node 18+ e PHP 8.1+ (`pdo_sqlite`, `curl`, `fileinfo`), Apache com
  `mod_rewrite`. Em produção, o contêiner de `deploy/`.
- Comentário e documentação em português. Comentário explica o porquê.
- Mudança visível ao usuário entra no `CHANGELOG.md`.
- Teste novo em `tests/` (Vitest), `tests/php/` (PHP) ou `tests/e2e/` (Playwright).
- Commits no padrão Conventional Commits do monorepo.
