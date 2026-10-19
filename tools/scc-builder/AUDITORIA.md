# Convert3D — Auditoria Técnica e Roadmap de Estabilização

> **DOCUMENTO HISTÓRICO. Não descreve o estado atual.**
>
> Esta auditoria foi feita na **v1.0.0**, e as três lacunas estruturais que ela
> aponta — API de conversão como stub, otimização inexistente, sem loader de
> IFC/3MF — **motivaram a reescrita da v2.0.0**, no dia seguinte. A v2 trouxe o
> pipeline real com `gltf-transform`, a fila assíncrona com worker, a camada de
> segurança e o módulo de integração com a plataforma de origem.
>
> O Convert3D chegou à **v2.8.0**, da qual o SCC Builder deriva. Para o estado atual, leia o
> [`README.md`](README.md) — a tabela dele cobre o que está implementado e
> testado — e o [`CHANGELOG.md`](CHANGELOG.md), que registra o que cada versão
> mudou.
>
> Este arquivo fica porque explica **por que** o projeto foi reescrito, e
> porque uma auditoria só vale se ninguém a apagar quando incomoda.

**Data:** 2026-08-08
**Escopo analisado:** `src/`, `api/`, `sdk/`, `bin/`, `docs/`, `index.html`, `vite.config.js`, `package.json`
**Versão:** 1.0.0 · Three.js r170 · Vite 6 · PHP 8.1+

---

## 1. Veredito Geral

O projeto tem uma **base sólida no frontend** — o `StudioViewer` é bem estruturado, o `ModelConverter` cobre os formatos certos, e a UI está madura. Mas o produto **não entrega hoje o que a documentação promete**. Há três lacunas estruturais:

| Área                            | Estado real                        | Estado documentado                      |
| ------------------------------- | ---------------------------------- | --------------------------------------- |
| Conversão no browser            | ✅ Funciona (GLB/GLTF/STL/OBJ/PLY) | ✅ Coerente                             |
| Conversão no servidor (API/CLI) | ❌ **Não existe** — é um stub      | ✅ "REST API de conversão"              |
| Otimização de polígonos         | ❌ Não implementada                | ✅ "GLB otimizado, game-ready"          |
| Suporte IFC / 3MF               | ❌ Sem loader                      | ✅ Listado no README e no card do Revit |
| Segurança da API                | ❌ Aberta, sem auth                | — (não mencionada)                      |

**Classificação de maturidade: protótipo avançado / demo técnica.** Não é seguro expor a API em rede hoje.

---

## 2. Bloqueadores Críticos

### 🔴 C1 — `bin/convert.js` é um stub, não converte nada

O CLI valida argumentos, cria o diretório de saída, imprime `status: "COMPLETED"` e faz `exit(0)`. **Nenhum arquivo de saída é escrito.**

Consequência em cadeia:

- `api/convert.php` faz `$isConverted = ($returnCode === 0 && file_exists($outputPath))` → sempre `false`.
- A API devolve `converted: false` e a URL do **arquivo original**, não do GLB.
- O SDK PHP considera isso "sucesso" (`status === 'success'`), então o integrador recebe um FBX achando que recebeu um GLB.

**Correção:** implementar conversão real no Node com `three` + `jsdom`/`node-three-gltf`, ou — mais robusto — delegar para uma ferramenta nativa:

- `gltf-transform` (Node, oficial Khronos) para GLTF↔GLB, Draco, meshopt, KTX2.
- `assimp` ou `FBX2glTF` (binário) para FBX/DAE/OBJ → glTF.
- Pipeline recomendado: `FBX2glTF/assimp → .gltf → gltf-transform (weld, dedup, draco, resize textures) → .glb`.

### 🔴 C2 — API sem autenticação alguma

`api/config.php` envia `Access-Control-Allow-Origin: *` e nenhum endpoint valida identidade.

- Qualquer origem pode fazer upload de arquivos de até **500 MB** — DoS de disco trivial.
- `models.php` com `DELETE` permite **apagar qualquer arquivo** de `uploads/` e `converted/` sem credencial.
- `models.php` com `GET` **lista todos os arquivos de todos os usuários**.

**Correção mínima:** header `X-API-Key` validado contra um `.env`/`config.local.php` fora do webroot; CORS restrito a uma allowlist; rate limiting por IP; `DELETE` só com escopo de dono.

### 🔴 C3 — Diretório de upload gravável dentro do webroot

`mkdir(UPLOAD_DIR, 0777, true)` cria `uploads/` em `C:\wamp64\www\convert3d\uploads` — servido diretamente pelo Apache, com permissão total.

A validação é **apenas por extensão** (`$ALLOWED_EXTENSIONS`), sem checar magic bytes/MIME. Um `.obj` ou `.dae` é texto puro — dá para embutir payload e, se qualquer misconfiguração de handler existir, executar.

**Correção:**

1. Mover `uploads/` e `converted/` para **fora** de `www/` e servir via script PHP com `readfile()` + `Content-Disposition`.
2. Se isso não for possível, colocar em ambos os diretórios:
   ```apache
   # uploads/.htaccess
   php_flag engine off
   RemoveHandler .php .phtml .php3 .php5 .phar
   <FilesMatch "\.(?i:php|phtml|phar|htaccess)$">
     Require all denied
   </FilesMatch>
   ```
3. Permissões `0755`, nunca `0777`.
4. Validar magic bytes: `glTF` (0x676C5446) para GLB, `Kaydara FBX Binary` para FBX, `solid`/0x80-header para STL.

### 🔴 C4 — `exec()` frágil e com erros silenciados

```php
$nodeBin = 'node';
@exec($cmd . ' 2>&1', $cliOutput, $returnCode);
```

- No WAMP, o Apache normalmente **não tem `node` no PATH** → falha silenciosa.
- `@` suprime o erro; não há log.
- `$nodeBin` deveria ser configurável (`NODE_BIN` no config) e passado por `escapeshellarg`.
- Sem timeout: um FBX de 400 MB trava o worker do Apache até `max_execution_time`.

**Correção:** caminho absoluto configurável, `proc_open` com timeout, log estruturado em `logs/convert.log`, e — para arquivos grandes — **fila assíncrona** (ver §5, Fase 3).

---

## 3. Bugs Funcionais Confirmados

### 🟠 F1 — `centerAndScaleModel()` tem matemática incorreta

```js
this.currentModel.position.x += this.currentModel.position.x - center.x;
this.currentModel.position.z += this.currentModel.position.z - center.z;
```

Isso só funciona quando `position` é `(0,0,0)`. Correto:

```js
this.currentModel.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
```

Como o botão **"Centralizar Pivot"** chama isso repetidamente, o modelo **deriva pela cena** a cada clique.

### 🟠 F2 — Modo X-Ray é irreversível

`setRenderMode('xray')` define `transparent = true; opacity = 0.4`, mas `'shaded'` nunca restaura. O modelo fica 40% transparente permanentemente. Além disso, `child.material.pointsMode = false` **não é uma propriedade do Three.js** — é código morto.

**Correção:** salvar o estado original do material (`userData.__origOpacity`) antes de mutar e restaurar no `shaded`.

### 🟠 F3 — Materiais multi-material quebram o editor PBR

`updateSelectedMaterial()` assume `child.material` como objeto único. Modelos de Revit/3ds Max frequentemente têm `material` como **array**. `mat.color.set(...)` lança `TypeError` e o painel PBR para de funcionar.

Além disso, os materiais são **compartilhados por referência** — editar a cor de uma parede muda todas as paredes que usam o mesmo material. Isso pode ser intencional, mas não está exposto na UI (não há lista de materiais).

**Correção:** normalizar com `const mats = Array.isArray(m) ? m : [m]` e construir um **painel de lista de materiais** (nome + preview) em vez de "material do objeto selecionado".

### 🟠 F4 — Vazamento de memória GPU

`setModel()` faz `scene.remove(this.currentModel)` mas **nunca chama `.dispose()`** em geometrias, materiais ou texturas. Carregar 5–6 modelos arquitetônicos grandes em sequência esgota a VRAM e derruba o contexto WebGL.

**Correção:** implementar `disposeObject3D(obj)` que percorre e faz dispose de `geometry`, cada material e todas as texturas (`map`, `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `emissiveMap`).

### 🟠 F5 — `.gltf` (JSON) e assets externos não carregam

`converter.js` passa `arrayBuffer` para `gltfLoader.parse()` — isso só é válido para **GLB binário**. Para `.gltf` JSON é preciso passar string, e os `.bin`/texturas externos nunca resolvem (`resourcePath` vazio).

Mesmo problema em:

- **OBJ** — `objLoader.parse(text)` sem `MTLLoader` → todo OBJ carrega cinza, sem material.
- **FBX** — `fbxLoader.parse(buffer, '')` com resource path vazio → texturas externas quebram (só funciona FBX com _Embed Media_).
- **DAE** — mesmo caso.

**Correção:** aceitar upload de **múltiplos arquivos relacionados** (drag de pasta / `webkitdirectory`), montar um `LoadingManager` com `setURLModifier` que resolve nomes de arquivo para `URL.createObjectURL()` dos arquivos irmãos.

### 🟠 F6 — IFC e 3MF prometidos mas inexistentes

`$ALLOWED_EXTENSIONS` inclui `ifc` e `3mf`; o card do Revit oferece `accept=".fbx,.ifc"`. Mas `converter.js` não tem `IFCLoader` nem `ThreeMFLoader` → rejeita com _"Format '.ifc' is not supported"_.

**Correção:** ou adicionar `web-ifc-three` + `ThreeMFLoader`, ou **remover** IFC/3MF do README, do config e dos cards. Prometer menos é melhor que falhar.

### 🟠 F7 — Otimização de polígonos não existe

O README vende "GLB otimizado / game-ready" e a API tem parâmetro `optimize`, mas **nada é feito com ele**. Não há decimação, merge de geometrias, dedup de materiais, Draco, meshopt ou KTX2.

Para arch-viz isso é _a_ proposta de valor: um FBX de Revit sai com 5–15 M triângulos e centenas de draw calls; sem otimização o GLB é inutilizável em WebXR/mobile.

**Correção (frontend):** `SimplifyModifier` do Three.js (limitado) ou `meshoptimizer` via WASM. **(Backend):** `gltf-transform` — `dedup`, `weld`, `join`, `simplify`, `draco`, `textureCompress`.

### 🟡 F8 — Métricas de volume/peso são enganosas

```js
const volumeCm3 = Math.abs(size.x * size.y * size.z * 0.75);
```

É o volume da bounding box × 0,75 — um chute. A "Estimativa de Peso por Material" derivada disso não tem significado físico. Para uma casa, o erro é de ordens de magnitude.

**Correção:** volume real por soma de tetraedros com sinal (`Σ (v0 · (v1 × v2)) / 6`) sobre a malha triangulada. É O(n) e exato para malhas fechadas. Para malhas abertas, sinalizar "malha não estanque — volume indisponível".

Área de superfície tem o mesmo problema (usa a bbox, não a malha).

### 🟡 F9 — Slicer em espaço-mundo, não ajustado ao modelo

Os planos de corte têm `constant` fixo em 100 e normais negativas. Como os sliders operam em valores absolutos de mundo, num modelo de 2 m nada acontece até o slider chegar quase a zero; num modelo de 200 m, corta tudo de uma vez.

**Correção:** normalizar os sliders para 0–1 e mapear para o intervalo da bounding box do modelo carregado.

### 🟡 F10 — Sem seleção por clique na viewport

O `TransformControls` está montado, mas só é possível selecionar objetos pela árvore de hierarquia. Um editor 3D precisa de **raycast picking** no canvas (com outline/highlight do selecionado).

### 🟡 F11 — Árvore de hierarquia não escala

`buildHierarchyTree` cria recursivamente um `<div>` com estilos inline para **cada nó** da cena. Um modelo de Revit tem facilmente 5.000–50.000 nós → a aba congela o browser por dezenas de segundos.

**Correção:** expansão lazy (só renderiza filhos ao abrir o nó) + virtualização de lista.

### 🟡 F12 — Parsing bloqueia a main thread

`FBXLoader.parse()` de um arquivo de 200 MB congela a aba inteira, sem progresso, sem cancelamento. O spinner nem chega a pintar.

**Correção:** mover o parsing para um **Web Worker** com `OffscreenCanvas`/transferable buffers, e emitir eventos de progresso reais.

### 🟡 F13 — XSS via nome de arquivo

`showToast()` e `buildHierarchyTree()` injetam `file.name` e `obj.name` via `innerHTML`. Um arquivo chamado `<img src=x onerror=alert(1)>.glb` executa script. Severidade baixa (local), mas trivial de corrigir com `textContent`.

---

## 4. Problemas de Arquitetura e Engenharia

| #   | Problema                                                                                               | Impacto                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Sem repositório Git, sem `.gitignore`** — `node_modules/` e `dist/` soltos na pasta                  | Sem histórico, sem rollback, sem colaboração                                                                                                |
| A2  | **Zero testes** (unitários, integração ou E2E)                                                         | Toda regressão é descoberta em produção                                                                                                     |
| A3  | **Sem lint/format** (ESLint, Prettier, PHP-CS-Fixer, PHPStan)                                          | Inconsistência e bugs silenciosos                                                                                                           |
| A4  | **Sem CI**                                                                                             | Nada valida build/PR                                                                                                                        |
| A5  | **URL da API hardcoded**: `fetch('/convert3d/api/convert.php')`                                        | Quebra em qualquer deploy fora de `/convert3d/` — use `import.meta.env.BASE_URL`                                                            |
| A6  | **`base: '/convert3d/'` fixo no Vite**                                                                 | Mesmo problema; use variável de ambiente                                                                                                    |
| A7  | **Bundle único de 906 KB** (`dist/assets/index-*.js`)                                                  | Sem code-splitting; os 6 loaders são carregados sempre. Devem ser `import()` dinâmico por extensão                                          |
| A8  | **Lucide via `unpkg@latest` em `<script>`** — e também como dep npm                                    | CDN não fixada (risco de supply-chain e quebra), duplicação, e `setTimeout(50)` para `createIcons()` é _race condition_                     |
| A9  | **Sem persistência/DB** — `models.php` faz `glob()` do disco                                           | Sem metadados, sem dono, sem paginação; com 10 mil arquivos a resposta fica gigante e lenta                                                 |
| A10 | **`models.php` GET com `action` desconhecida não responde nada**                                       | Retorna 200 com corpo vazio (fall-through sem `else`)                                                                                       |
| A11 | **Limites do PHP não documentados**                                                                    | `MAX_FILE_SIZE` é 500 MB, mas os defaults do PHP são `upload_max_filesize=2M` / `post_max_size=8M` — upload falha antes de chegar ao código |
| A12 | **SDK sem API key, sem retry; `CURLOPT_TIMEOUT=60`**                                                   | Insuficiente para 500 MB; `mime_content_type()` costuma falhar em `.fbx`                                                                    |
| A13 | **Deploy ambíguo** — README manda copiar `dist/` para a raiz, mas já há um `index.html` de dev na raiz | Colisão; o `.htaccess`/DocumentRoot deveria apontar para `dist/`                                                                            |
| A14 | **Sem arquivo `LICENSE`** apesar do README declarar MIT                                                | Ambiguidade legal                                                                                                                           |
| A15 | **Sem acessibilidade** — árvore e modais sem ARIA, sem navegação por teclado, estados só por cor       | Barreira de uso e conformidade                                                                                                              |
| A16 | **`animate()` roda em loop infinito sem pausa**                                                        | Consome GPU mesmo com a aba ociosa/oculta; use `renderer.setAnimationLoop` + `document.hidden`                                              |
| A17 | **Resize só via `window`**                                                                             | Colapsar/expandir painéis laterais não redimensiona o canvas — use `ResizeObserver` no container                                            |
| A18 | **Sem undo/redo** apesar de ser um "editor"                                                            | Toda edição de transform/material é destrutiva                                                                                              |

> **Nota:** não consegui rodar `vite build` no sandbox Linux porque `node_modules/` contém binários nativos do Rollup compilados para Windows. Isso **não é um bug do projeto** — é diferença de plataforma.

---

## 5. Roadmap de Estabilização

### Fase 0 — Fundação (1–2 dias) · _pré-requisito de tudo_

1. `git init` + `.gitignore` (`node_modules/`, `dist/`, `uploads/`, `converted/`, `*.local.php`, `logs/`)
2. Adicionar `LICENSE` (MIT)
3. ESLint + Prettier no JS; PHPStan (nível 5) + PHP-CS-Fixer no PHP
4. GitHub Actions: `npm ci && npm run build` + lint em cada push
5. Vitest configurado (mesmo sem testes ainda)

### Fase 1 — Honestidade e Segurança (3–5 dias) · **🔴 obrigatório antes de qualquer exposição**

6. **Corrigir C2:** autenticação por `X-API-Key`, CORS com allowlist, rate limiting
7. **Corrigir C3:** mover `uploads/`/`converted/` para fora do webroot (ou `.htaccess` + `0755`) + validação de magic bytes
8. **Corrigir C4:** `NODE_BIN` configurável, `proc_open` com timeout, logging real (sem `@`)
9. **Corrigir F6:** remover IFC/3MF do README, do `$ALLOWED_EXTENSIONS` e dos cards _(ou_ implementar os loaders)
10. **Ajustar o README** para refletir o estado real: marcar conversão server-side e otimização como _roadmap_, não como _feature_
11. **Corrigir F13:** trocar `innerHTML` por `textContent` nos caminhos que recebem nome de arquivo
12. Documentar os ajustes de `php.ini` necessários (A11)

### Fase 2 — Correções do Editor (5–8 dias)

13. **F1** pivot/centralização (correção de 1 linha, alto impacto)
14. **F4** `disposeObject3D()` completo no `setModel()`
15. **F2** salvar/restaurar estado de material nos modos de render; remover `pointsMode`
16. **F3** suporte a arrays de material + painel de lista de materiais
17. **F5** `LoadingManager` com `setURLModifier` para assets multi-arquivo (OBJ+MTL, FBX+texturas, glTF+bin)
18. **F8** volume real por tetraedros com sinal + detecção de malha estanque
19. **F9** sliders do slicer normalizados pela bounding box
20. **F10** raycast picking na viewport com outline de seleção
21. **A16/A17** `setAnimationLoop` + `ResizeObserver`
22. Testes unitários dos utilitários geométricos (volume, área, bbox, dispose)

### Fase 3 — Conversão Real no Servidor (8–12 dias) · **entrega a promessa central**

23. Substituir `bin/convert.js` por um pipeline real:
    `assimp`/`FBX2glTF` → `.gltf` → `gltf-transform` (`dedup`, `weld`, `join`, `simplify`, `draco`, `textureCompress --codec ktx2`) → `.glb`
24. Implementar de fato o parâmetro `optimize` com níveis (`none` / `balanced` / `aggressive`)
25. **Fila assíncrona**: `POST /convert` retorna `202` + `job_id`; `GET /jobs/{id}` devolve status/progresso. Worker via `supervisor`/Task Scheduler
26. Persistência em SQLite/MySQL: `jobs`, `models` (dono, tamanho, contagem de tri, tempo de conversão, hash)
27. Reescrever `models.php` sobre o banco, com paginação e escopo por dono
28. Atualizar o SDK PHP: API key, retries com backoff, `pollJob()`, timeout configurável
29. Testes de integração da API (PHPUnit + fixtures reais de FBX/OBJ/DAE)

### Fase 4 — Performance e Escala (5–8 dias)

30. **F12** parsing em Web Worker com progresso e cancelamento
31. **F11** árvore de hierarquia lazy + virtualizada
32. **A7** code-splitting: `import()` dinâmico por loader, conforme a extensão
33. **F7** otimização no cliente (`meshoptimizer` WASM) com preview antes/depois de triângulos
34. `DRACOLoader` + `KTX2Loader` no viewer para abrir GLBs comprimidos
35. LOD automático + frustum culling para cenas arquitetônicas grandes
36. **A8** remover a CDN do Lucide; importar do npm com tree-shaking

### Fase 5 — Produto (contínuo)

37. Undo/redo com command pattern
38. Presets de exportação por engine (Unity / Unreal / Three.js / WebXR) com convenções de eixo e escala corretas
39. Colisores por-mesh (box, sphere, convex hull) em vez de uma única box da cena inteira
40. Acessibilidade (ARIA, teclado, foco visível)
41. Testes E2E (Playwright): importar → editar → exportar
42. `docs/` alinhado ao comportamento real + changelog

---

## 6. Top 10 — Ordem de Ataque Recomendada

Se o tempo for curto, esta é a sequência de maior retorno:

| #   | Item                                                 | Esforço  | Impacto    |
| --- | ---------------------------------------------------- | -------- | ---------- |
| 1   | `.gitignore` + `git init`                            | 15 min   | 🔴 Crítico |
| 2   | Corrigir pivot `centerAndScaleModel()` (F1)          | 15 min   | 🟠 Alto    |
| 3   | Remover IFC/3MF ou implementar loaders (F6)          | 30 min   | 🟠 Alto    |
| 4   | `.htaccess` em `uploads/` + `chmod 0755` (C3)        | 30 min   | 🔴 Crítico |
| 5   | API key + CORS allowlist (C2)                        | 3 h      | 🔴 Crítico |
| 6   | `dispose()` de geometrias/materiais/texturas (F4)    | 3 h      | 🟠 Alto    |
| 7   | Alinhar README ao estado real                        | 1 h      | 🟠 Alto    |
| 8   | Arrays de material + restaurar x-ray (F2/F3)         | 4 h      | 🟡 Médio   |
| 9   | Raycast picking na viewport (F10)                    | 4 h      | 🟡 Médio   |
| 10  | Pipeline de conversão real com `gltf-transform` (C1) | 3–5 dias | 🔴 Crítico |

---

## 7. Definição de "Estável e Funcional"

O projeto pode ser considerado estável quando:

- [ ] Todo formato listado no README carrega de fato, com materiais e texturas
- [ ] Conversão server-side produz um GLB válido, verificado pelo validador glTF da Khronos
- [ ] A API exige autenticação e rejeita uploads maliciosos
- [ ] Carregar 10 modelos grandes em sequência não degrada memória nem FPS
- [ ] Nenhuma operação bloqueia a UI por mais de 100 ms
- [ ] `npm run build` passa no CI, com lint limpo
- [ ] Cobertura de testes ≥ 60% nos módulos de geometria e API
- [ ] Um FBX de 100 MB do Revit converte para GLB otimizado em < 60 s, com redução de ≥ 70% no tamanho
- [ ] README e `docs/` descrevem exatamente o comportamento implementado
