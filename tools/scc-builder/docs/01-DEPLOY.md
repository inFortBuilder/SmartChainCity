# Deploy no Apache

Como colocar o SCC Builder no ar, do zero até rodando em produção.

---

## Caminho rápido (5 minutos)

Abra o **Prompt de Comando** em `C:\wamp64\www\scc-builder`:

```bat
instalar.bat
```

O script faz, em sequência:

1. `npm install`
2. Configuração — gera as chaves, escreve `api/config.local.php` e `.env`,
   cria o storage **fora do webroot** e inicializa o SQLite
3. `npm run build`
4. Validação completa (~45 verificações)

Ao final, se estiver tudo certo:

```
==========================================================
   PRONTO - o sistema esta no ar
==========================================================

   Editor:  http://localhost/scc-builder/
   Health:  http://localhost/scc-builder/api/health.php
```

Depois, **como Administrador**, registre o worker da fila:

```bat
bin\windows\worker-instalar.bat
```

Pronto. O sistema está rodando.

---

## O que o instalador decide sozinho

| Item            | Decisão                                                                                  | Como sobrescrever                                                   |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Binário do Node | `where node`, depois locais padrão do Windows                                            | edite `node_bin` no config                                          |
| Caminho público | nome da pasta → `/scc-builder/`                                                          | `--base=/outro/`                                                    |
| Storage         | irmão de `www/`, ex.: `C:/wamp64/scc-builder-storage`                                    | `--storage=D:/dados`                                                |
| Credenciais     | `jwt_secret` local e duas API keys: `world` (servidor a servidor) e `dev` (editor local) | `--forcar-chaves` regera; em produção use o `jwt_secret` do gateway |

Exemplo com tudo customizado:

```bat
php bin\instalar.php --base=/3d/ --storage=D:\scc-builder-dados --forcar-chaves
```

O instalador é **idempotente**: rodar de novo preserva as chaves existentes e
faz backup dos arquivos antes de reescrever.

---

## Pré-requisitos que ele não resolve sozinho

### Módulos do Apache

Ícone do WAMP → **Apache** → **Apache modules**. Precisam estar marcados:

| Módulo           | Para quê                     | Sem ele                                    |
| ---------------- | ---------------------------- | ------------------------------------------ |
| `rewrite_module` | roteamento para `dist/`      | **obrigatório** — a página não abre        |
| `headers_module` | headers de segurança e cache | assets sem cache, sem CSP                  |
| `deflate_module` | compressão gzip              | `three-core` baixa 664 KB em vez de 180 KB |
| `expires_module` | validade do cache            | revalidação a cada carga                   |

O `api/health.php` verifica os quatro e avisa quais estão faltando.

### Extensões do PHP

Ícone do WAMP → **PHP** → **PHP extensions**: `pdo_sqlite`, `curl`, `fileinfo`.

### Limites do php.ini

O `.htaccess` já define os limites via `php_value`, o que cobre a instalação
padrão do WAMP (PHP como módulo do Apache). Se você usa PHP-FPM, ajuste no
`php.ini`:

```ini
upload_max_filesize = 512M
post_max_size       = 512M
max_execution_time  = 300
memory_limit        = 512M
```

**Reinicie os serviços** do WAMP depois de qualquer alteração.

---

## Como o Apache serve o projeto

```
http://localhost/scc-builder/
        │
        ├── /api/*  ──────────────────► api/*.php        (PHP direto)
        │
        ├── /assets/* ────────────────► dist/assets/*    (JS, CSS, worker)
        │
        └── qualquer outra rota ──────► dist/index.html  (SPA)

  Bloqueado por HTTP:  src/  bin/  tests/  node_modules/
                       integrations/  docs/  sdk/  .git/
                       storage/  *.md  *.bat  config.local.php
```

O `.htaccess` da raiz cuida disso. Pontos que valem atenção:

**Nada de `RewriteBase`.** Em contexto de diretório o Apache já resolve as
substituições relativas contra a pasta do `.htaccess`. Fixar `RewriteBase /`
quebraria a instalação em subdiretório — é o erro clássico desse tipo de
configuração.

**MIME types 3D.** O Apache não conhece `.glb`, `.wasm` nem `.ktx2` por padrão
e devolveria `application/octet-stream`. O `KTX2Loader` recusa instanciar o
WASM com o MIME errado, então isso não é cosmético.

**Cache imutável só nos arquivos com hash.** O Vite gera `index-BSS4sThA.js`,
então esses podem valer um ano. O `index.html` é sempre revalidado — sem isso
o usuário fica preso numa versão antiga depois de cada deploy.

**CSP com `wasm-unsafe-eval`.** Os decodificadores Draco e Meshopt precisam
disso. Os CDNs liberados (`gstatic.com`, `unpkg.com`) servem apenas os
transcoders WASM; se você hospedar os decodificadores localmente, remova-os
da política e ajuste `DRACO_DECODER_PATH` em `src/converter.js`.

---

## Domínio próprio (opcional)

Para trocar `http://localhost/scc-builder/` por `http://scc-builder.local`:

1. Copie o conteúdo de [`docs/apache/scc-builder-vhost.conf`](apache/scc-builder-vhost.conf)
   para `C:\wamp64\bin\apache\apache2.4.x\conf\extra\httpd-vhosts.conf`
2. Adicione em `C:\Windows\System32\drivers\etc\hosts` (como admin):
   ```
   127.0.0.1  scc-builder.local
   ```
3. Reconfigure a base:
   ```bat
   php bin\instalar.php --base=/ --url=http://scc-builder.local/api
   npm run build
   ```
4. Reinicie o Apache

No vhost o `DocumentRoot` aponta direto para `dist/`, e a API entra por
`Alias`. O código-fonte fica inacessível **por construção**, não por regra de
bloqueio — é mais seguro que a configuração em subdiretório.

---

## O worker da fila

Arquivos acima de 16 MB não são convertidos na requisição HTTP: entram numa
fila. Isso evita que o Apache fique bloqueado minutos processando um FBX de
300 MB.

```bat
bin\windows\worker-instalar.bat     REM como Administrador
bin\windows\worker-status.bat       REM situacao da fila e do agendamento
bin\windows\worker-remover.bat      REM desregistra
```

A tarefa roda `worker.php --once --max-jobs=20` a cada minuto. O `--once` é
proposital: em vez de um processo residente que pode travar, cada ciclo
esvazia a fila e sai. Se algo der errado, o ciclo seguinte se recupera.

Para acompanhar em tempo real durante testes:

```bat
php bin\worker.php --verbose
```

**Sem o worker registrado, uploads grandes ficam em `queued` para sempre.**
É a causa mais comum de "enviei e não aconteceu nada".

---

## Verificação

```bat
validar.bat
```

Ou só o servidor:

```bat
php bin\validar.php
```

E pelo browser, autenticado:

```bat
curl -H "X-API-Key: SUA_CHAVE" http://localhost/scc-builder/api/health.php
```

O campo `checks.apache` mostra o estado dos módulos, e `warnings` deve vir
vazio.

Depois disso, siga a parte 5 do [`02-VALIDACAO.md`](02-VALIDACAO.md) — as
verificações de browser que nenhum script consegue fazer.

---

## Atualizações

Ao trocar o código:

```bat
git pull
npm install
npm run build
php bin\validar.php
```

O `config.local.php` e o `.env` não são tocados — estão no `.gitignore`.

Se mudar algo em `api/`, nada além disso é necessário: PHP não tem build.

---

## Checklist de produção

> Na infraestrutura da Smart Chain City o caminho é o contêiner de
> [`deploy/`](../deploy/README.md). Este checklist vale para os dois.

Antes de expor para fora da sua máquina:

- [ ] `allow_public` está `false` em `api/config.local.php`
- [ ] `cors_origins` lista os domínios reais, sem `*`
- [ ] `jwt_secret` é o do gateway SCC (e `jwt_issuer`/`jwt_audience` preenchidos)
- [ ] As chaves de API têm 64 caracteres hexadecimais e `VITE_API_KEY` está **vazio** no build
- [ ] O header `Authorization` chega ao PHP (o `validar.php` testa: "JWT do gateway é aceito")
- [ ] `storage_dir` está **fora** do webroot
- [ ] `debug` está `false`
- [ ] HTTPS configurado (veja o bloco comentado no vhost)
- [ ] O worker está registrado no Agendador
- [ ] `php bin\validar.php` passa sem falhas
- [ ] Backup do `storage/scc-builder.sqlite` agendado
- [ ] `retention_days` ajustado ao seu volume de disco

Teste o bloqueio na prática — todas estas URLs devem devolver 403 ou 404:

```
http://localhost/scc-builder/api/config.local.php
http://localhost/scc-builder/api/lib/Security.php
http://localhost/scc-builder/src/main.js
http://localhost/scc-builder/package.json
http://localhost/scc-builder/storage/scc-builder.sqlite
```

O `validar.php` já testa a última, que é a mais crítica.

---

## Problemas comuns

| Sintoma                             | Causa                                                                          | Solução                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Página em branco em `/scc-builder/` | `mod_rewrite` desativado, ou falta o build                                     | Ative o módulo; rode `npm run build`                             |
| CSS e JS dão 404                    | `VITE_BASE_PATH` diferente do caminho real                                     | `php bin\instalar.php --base=/caminho/` e rebuild                |
| `not_configured` na API             | Falta `api/config.local.php`                                                   | `php bin\instalar.php`                                           |
| `missing_credentials` no editor     | Editor aberto sem `#token=`, ou `.env` de desenvolvimento sem `VITE_SCC_TOKEN` | Abra pelo link do jogo; em dev, `php bin	oken-dev.php`            |
| `invalid_token` com token correto   | Apache descartando `Authorization` (PHP como CGI/FPM)                          | O `api/.htaccess` repassa o header; confira `mod_setenvif` ativo |
| `node_not_found`                    | Apache não herda o seu PATH                                                    | Caminho absoluto em `node_bin`                                   |
| Jobs presos em `queued`             | Worker não registrado                                                          | `bin\windows\worker-instalar.bat` como admin                     |
| Upload falha acima de 2 MB          | Limites do PHP                                                                 | Confira `mod_php` ativo, ou ajuste o `php.ini`                   |
| `external_converter_missing`        | FBX/DAE sem conversor                                                          | Instale o FBX2glTF, ou exporte OBJ/GLB                           |
| 500 sem mensagem                    | Erro na inicialização do PHP                                                   | Veja `storage\logs\api-*.jsonl` e o error.log do Apache          |

Toda resposta de erro da API traz um `request_id`. Procure por ele em
`storage\logs\api-AAAA-MM-DD.jsonl` — cada linha é um JSON com o contexto
completo.

---

## Estrutura em produção

```
C:\wamp64\
├── www\scc-builder\           ← projeto (servido pelo Apache)
│   ├── .htaccess            roteamento, MIME, cache, segurança
│   ├── dist\                build servido ao usuário
│   ├── api\                 endpoints PHP
│   │   └── config.local.php segredos (NÃO versionado, bloqueado por HTTP)
│   ├── bin\                 CLI, worker, instalador, validador
│   ├── src\  tests\  docs\  bloqueados por HTTP
│   └── node_modules\        bloqueado por HTTP
│
└── scc-builder-storage\       ← FORA do webroot
    ├── scc-builder.sqlite     banco de jobs
    ├── uploads\             arquivos recebidos
    ├── converted\           GLBs gerados
    └── logs\                api-AAAA-MM-DD.jsonl
```

O storage separado é o que garante que nenhum arquivo enviado por terceiros
seja alcançável por URL — nem que o Apache seja mal configurado depois.
