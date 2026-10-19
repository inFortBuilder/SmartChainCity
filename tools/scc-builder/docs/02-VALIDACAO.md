# Roteiro de validação no WAMP

Como confirmar que a instalação está correta, do zero até o `validate-lot`.
Tempo estimado: **20 a 30 minutos**.

A parte servidor é automatizada (`php bin/validar.php`). A parte de browser é
manual, porque envolve WebGL e interação — coisas que um script não consegue
julgar de forma confiável.

---

## Parte 0 — Preparação (5 min)

### 0.1 Destravar o git

Ficou um lock de uma operação interrompida:

```bat
cd C:\wamp64\www\scc-builder
del .git\index.lock
git add -A
git commit -m "feat(v2.1): Web Worker, otimizacao no cliente, presets de engine e undo/redo"
git log --oneline
```

**Esperado:** dois commits listados.

### 0.2 Instalar dependências

```bat
cd C:\wamp64\www\scc-builder
npm install
```

**Esperado:** termina sem `ERR!`. Baixa ~240 pacotes.

> Se aparecer erro no `sharp`, ignore — é dependência opcional, usada apenas
> para recomprimir texturas. Todo o resto funciona sem ela.

### 0.3 Configurar a API

```bat
copy api\config.local.example.php api\config.local.php
php -r "echo bin2hex(random_bytes(32));"
```

Rode o comando duas vezes e edite `api/config.local.php` (ou deixe o
`instalar.bat` fazer isso):

```php
'jwt_secret' => 'COLE_O_PRIMEIRO_VALOR',   // em produção: o do gateway SCC
'api_keys' => [
    'dev' => 'COLE_O_SEGUNDO_VALOR',
],
'storage_dir' => 'C:/wamp64/scc-builder-storage',
'node_bin'    => 'C:/Program Files/nodejs/node.exe',
```

Confirme o caminho real do Node:

```bat
where node
```

### 0.4 Ajustar o php.ini

Ícone do WAMP → PHP → php.ini:

```ini
upload_max_filesize = 512M
post_max_size       = 512M
max_execution_time  = 300
memory_limit        = 512M
extension=pdo_sqlite
extension=curl
extension=fileinfo
```

**Reinicie todos os serviços** do WAMP depois de salvar.

### 0.5 Configurar o frontend

```bat
copy .env.example .env
```

Edite `.env` com um JWT de teste (ou a chave `dev`):

```bat
php bin	oken-dev.php 0xjogador-de-teste 480
```

```ini
VITE_BASE_PATH=/scc-builder/
VITE_API_BASE_URL=/scc-builder/api
VITE_SCC_TOKEN=COLE_O_TOKEN_AQUI
```

---

## Parte 1 — Validação automática do servidor (2 min)

```bat
cd C:\wamp64\www\scc-builder
php bin\validar.php
```

O script roda **cerca de 45 verificações** em 7 blocos:

| Bloco                  | O que confere                                              |
| ---------------------- | ---------------------------------------------------------- |
| 1. Ambiente PHP        | versão, extensões, limites de upload                       |
| 2. Configuração        | chave presente e forte, CORS sem `*`, `allow_public` off   |
| 3. Armazenamento       | existe, é gravável, está protegido                         |
| 4. Banco SQLite        | conexão, criação de job, reserva atômica da fila           |
| 5. Node e pipeline     | binário, pacotes, **conversão real de um cubo**            |
| 6. Validação de upload | aceita OBJ/GLB, rejeita PHP disfarçado e binário renomeado |
| 7. Endpoints HTTP      | auth, upload, download, path traversal, storage exposto    |

**Esperado no final:**

```
  45 passaram · 0 falharam · 1 avisos

  Instalação validada.
```

Cada falha vem com a correção logo abaixo. O código de saída é 1 se houver
qualquer falha, então dá para usar em script.

### Se o Apache estiver parado

```bat
php bin\validar.php --skip-http
```

### Aviso esperado (não é problema)

```
  ! Nenhum conversor de FBX/DAE no PATH
```

É opcional. Sem FBX2glTF ou Assimp, `.fbx` e `.dae` falham **no servidor** —
mas continuam abrindo normalmente no editor do browser. Para habilitar,
baixe o [FBX2glTF](https://github.com/facebookincubator/FBX2glTF/releases),
coloque o `.exe` em `C:\Tools\` e adicione ao PATH do sistema.

---

## Parte 2 — Testes unitários e build (3 min)

```bat
npm test
```

**Esperado:** `Test Files 4 passed (4)` · `Tests 78 passed (78)`

```bat
npm run lint
```

**Esperado:** nenhuma saída (zero avisos).

```bat
npm run build
```

**Esperado:** `✓ built in ~7s`, sem avisos de chunk. Confira os tamanhos:

```
dist/assets/index-*.js          ~75 kB
dist/assets/vendor-*.js         ~93 kB
dist/assets/three-core-*.js     ~664 kB
dist/assets/parser.worker-*.js  ~142 kB
```

Se `vendor` vier com ~695 kB, o tree-shaking dos ícones não funcionou.

---

## Parte 3 — CLI de conversão (2 min)

```bat
node bin\convert.js --help
```

Crie um OBJ de teste e converta:

```bat
php -r "file_put_contents('teste.obj', \"v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n\");"
node bin\convert.js -i teste.obj -o teste.glb --optimize aggressive
```

**Esperado:**

```
[scc-builder] entrada: teste.obj (obj, 68.0 B)
[scc-builder] interpretando OBJ com os parsers do Three.js
[scc-builder] otimização: dedup aplicado
[scc-builder] otimização: weld aplicado
[scc-builder] otimização: compressão Draco habilitada
[scc-builder] concluído em ~300ms
```

Confirme que o arquivo existe e começa com `glTF`:

```bat
dir teste.glb
php -r "echo substr(file_get_contents('teste.glb'),0,4);"
```

**Esperado:** `glTF`

Teste também o caminho de erro:

```bat
node bin\convert.js -i nao_existe.obj
echo %errorlevel%
```

**Esperado:** mensagem `input_not_found` e `errorlevel` = 1.

---

## Parte 4 — Worker da fila (2 min)

```bat
php bin\worker.php --once --verbose
```

**Esperado (fila vazia):**

```
[hh:mm:ss] Worker iniciado (pid 1234)
[hh:mm:ss] Node: C:/Program Files/nodejs/node.exe
[hh:mm:ss] Worker encerrado. Jobs processados: 0.
```

Se aparecer `ERRO: Node.js não encontrado`, o `node_bin` está errado.

Para deixar rodando em produção — Agendador de Tarefas do Windows, gatilho a
cada 1 minuto:

```
Programa:   C:\wamp64\bin\php\php8.1.0\php.exe
Argumentos: "C:\wamp64\www\scc-builder\bin\worker.php" --once
Iniciar em: C:\wamp64\www\scc-builder
```

---

## Parte 5 — Editor no browser (10 min)

```bat
npm run dev
```

Abra `http://localhost:5173/scc-builder/` e **deixe o console aberto (F12)**.

### 5.1 Inicialização

- [ ] O canvas 3D aparece com grid e eixos
- [ ] Nenhum erro vermelho no console
- [ ] Os ícones aparecem (se ficarem quadrados vazios, o tree-shaking do
      Lucide perdeu algum ícone — veja `src/ui/icons.js`)

### 5.2 Modelo de exemplo

- [ ] Escolha "Villa Moderna" no seletor de samples
- [ ] O modelo aparece **apoiado no grid**, não flutuando nem enterrado
- [ ] As estatísticas (vértices, triângulos) deixam de ser zero

### 5.3 Pivot — a correção F1

Clique em **Center Pivot & Align Ground** cinco vezes seguidas.

- [ ] O modelo **não sai andando** pela cena

Esse era o bug: `position.x += (position.x - center.x)` só funcionava com a
posição em zero, então cada clique deslocava o objeto.

### 5.4 Volume — a correção F8

- [ ] Com a villa carregada, o campo Volume mostra `cm³` **ou** `malha aberta`
- [ ] Passe o mouse sobre o valor: o tooltip explica qual dos dois casos é

Nunca deve aparecer um número inventado para malha não estanque.

### 5.5 Importação com texturas — a correção F5

Pegue um OBJ com `.mtl` e texturas e **arraste a pasta inteira** para a
dropzone.

- [ ] O modelo aparece **com material**, não cinza
- [ ] Se faltar algum arquivo, um toast amarelo lista quais

### 5.6 Seleção e árvore

- [ ] Clicar numa parede na viewport seleciona a malha (contorno ciano)
- [ ] A árvore rola sozinha até o item e o destaca
- [ ] Clicar na árvore seleciona na viewport
- [ ] Com a árvore focada: setas navegam, `→` expande, `←` colapsa, `Enter` seleciona

### 5.7 Undo/redo

- [ ] Arraste o gizmo (tecla `W`) e solte
- [ ] `Ctrl+Z` desfaz o movimento inteiro — **não** frame a frame
- [ ] `Ctrl+Y` refaz
- [ ] Arraste o slider de Roughness de ponta a ponta: `Ctrl+Z` uma única vez
      volta tudo (a fusão de comandos está funcionando)

### 5.8 Modo raio-X — a correção F2

- [ ] Ative wireframe (`Z`), depois volte para shaded
- [ ] O modelo volta **opaco**

Na v1 ele ficava 40% transparente para sempre.

### 5.9 Vazamento de memória — a correção F4

Troque de sample cinco vezes seguidas (villa → arranha-céu → engrenagem →
nó → villa).

- [ ] Nenhum erro de `context lost` no console
- [ ] O FPS não degrada
- [ ] No Gerenciador de Tarefas, a memória do Chrome se estabiliza em vez de
      subir a cada troca

### 5.10 Web Worker — a correção F12

Precisa de um OBJ ou STL **acima de 512 KB** (abaixo disso ele roda na main
thread, por design).

- [ ] A barra de progresso avança com percentual real
- [ ] A interface continua responsiva durante o carregamento
- [ ] O botão **Cancelar** interrompe de verdade
- [ ] Na aba Network do DevTools aparece o chunk `parser.worker-*.js`

### 5.11 Otimização

- [ ] Escolha "Agressiva" e clique em **Prever** — mostra antes/depois
- [ ] Clique em **Aplicar** — a contagem de triângulos cai de fato
- [ ] O modelo continua reconhecível (as quinas não viraram bolhas)

### 5.12 Presets de engine

- [ ] Selecione **Unreal Engine**, unidade **Metros**, eixo **Y-up**
- [ ] O painel de dicas mostra as notas do Unreal
- [ ] Clique em **Exportar com preset**
- [ ] O arquivo baixado se chama `*_unreal.glb`
- [ ] O toast informa `escala ×100, Y-up → Z-up`

### 5.13 Colisores

- [ ] Tipo **Convex Hull**, marque "um por malha", clique em Gerar
- [ ] Aparecem cascos laranja em wireframe ao redor de cada peça
- [ ] **Exportar colisores (JSON)** baixa um arquivo com `type: "convex"`

### 5.14 Acessibilidade

- [ ] `Tab` navega por todos os controles com foco visível
- [ ] Abra o modal de API: o `Tab` circula **dentro** dele
- [ ] `Esc` fecha e o foco volta ao botão que abriu
- [ ] `?` lista os atalhos

---

## Parte 6 — API via browser (2 min)

Ainda com `npm run dev` aberto:

- [ ] Clique em **PHP API & SDK**
- [ ] Escolha um arquivo 3D pequeno
- [ ] Clique em enviar

**Esperado:** JSON verde com `"status": "completed"` e métricas de conversão.

Se der `missing_credentials`, nem `VITE_SCC_TOKEN` nem `VITE_API_KEY` estão
no `.env`; `token_expired`, gere outro token. Lembre que o Vite **só relê o
`.env` ao reiniciar** o dev server.

---

## Parte 7 — Testes E2E (5 min, opcional)

```bat
npx playwright install chromium
npm run test:e2e
```

**Esperado:** `12 passed`.

Esses testes eu escrevi mas não consegui executar — o ambiente onde trabalhei
não baixa o Chromium. É a validação que mais me interessa ver o resultado.

Se algum falhar, `npx playwright show-report` abre o relatório com screenshot
e vídeo do momento da falha.

---

## Parte 8 — Produção no WAMP (3 min)

```bat
npm run build
```

Acesse `http://localhost/scc-builder/dist/`.

Para servir na raiz do projeto, crie `C:\wamp64\www\scc-builder\.htaccess`:

```apache
RewriteEngine On
RewriteCond %{REQUEST_URI} !^/scc-builder/(api|dist)/
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^(.*)$ dist/$1 [L]
```

Rode a validação de novo apontando para a instalação de produção:

```bat
php bin\validar.php --url=http://localhost/scc-builder/api
```

---

## Parte 9 — JWT e validate-lot (3 min)

```bat
npm run test:php
```

**Esperado:** todos os casos `ok` — JWT (assinatura, `exp`, `alg`, `iss`/`aud`),
escopo por `account_id`, layout do bucket, versões de `model_id`, as regras do
`validate-lot` e o endpoint chamado por HTTP num `php -S` temporário.

Contra a sua instalação, com um job convertido em `preset=scc`:

```bat
set JWT=<saída de php bin\token-dev.php 0xjogador-de-teste>
curl -X POST http://localhost/scc-builder/api/validate-lot.php ^
  -H "Authorization: Bearer %JWT%" -H "Content-Type: application/json" ^
  -d "{\"job_id\":\"job_…\",\"lot\":{\"polygon\":[[0,0],[50,0],[50,50],[0,50]],\"setback_m\":3,\"max_height_m\":160,\"far\":6}}"
```

- [ ] Responde `valid`, `checks` (scale, fits_setback, height, far, triangles), `footprint` e `suggested_floors`
- [ ] Com o JWT de outra conta, o mesmo `job_id` dá **404**
- [ ] Sem `Authorization`, **401** `missing_credentials`

---

## Se algo falhar

| Sintoma                         | Causa provável                                                       |
| ------------------------------- | -------------------------------------------------------------------- |
| `not_configured`                | Falta `api/config.local.php`                                         |
| `missing_credentials` no editor | `VITE_SCC_TOKEN`/`VITE_API_KEY` vazios, ou dev server não reiniciado |
| `invalid_token`                 | `jwt_secret` diferente do que assinou o token                        |
| `token_expired`                 | Gere outro com `php bin	oken-dev.php`                                 |
| `node_not_found`                | `node_bin` sem caminho absoluto                                      |
| Jobs presos em `queued`         | Worker não está rodando                                              |
| `external_converter_missing`    | FBX/DAE sem FBX2glTF ou Assimp no PATH                               |
| Upload falha acima de 2 MB      | `upload_max_filesize` do php.ini                                     |
| Página em branco no `/dist/`    | `VITE_BASE_PATH` diferente do caminho real                           |
| Ícones como quadrados vazios    | Ícone novo no HTML sem entrada em `src/ui/icons.js`                  |

Todo erro da API traz um `request_id`. Procure por ele em:

```
storage\logs\api-AAAA-MM-DD.jsonl
```

Cada linha é um JSON com o contexto completo da requisição.

---

## Registro dos resultados

Se algo falhar, me mande:

1. A saída completa de `php bin\validar.php`
2. Os erros do console do browser (F12)
3. As últimas linhas de `storage\logs\api-*.jsonl`

Com isso dá para diagnosticar sem precisar de acesso à sua máquina.
