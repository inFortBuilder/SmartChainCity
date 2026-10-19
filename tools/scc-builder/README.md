# SCC Builder — conversor e validador de prédios da Smart Chain City

![versão](https://img.shields.io/badge/SCC%20Builder-v0.1.0-00f0ff?style=for-the-badge)
![Three.js](https://img.shields.io/badge/Three.js-r170-purple?style=for-the-badge)
![PHP](https://img.shields.io/badge/PHP-8.1+-blue?style=for-the-badge)
![Node](https://img.shields.io/badge/Node-18+-green?style=for-the-badge)

> Converte projetos arquitetônicos (FBX, OBJ, DAE, GLB…) no **GLB "preset
> SCC"** que o jogador-construtor sobe no lote, e confere o modelo contra as
> regras do lote: recuo, gabarito, coeficiente de aproveitamento e orçamento
> de triângulos ([doc 13 §4–§5](../../docs/13-cidade-realista-construtores.md)).

> **Estado: v0.1.0, em desenvolvimento no monorepo** — ainda não publicado em
> nenhum ambiente. Derivado do Convert3D v2.8.0, sem vínculo de código em
> tempo de execução, de identidade nem de armazenamento com a aplicação de
> origem.
>
> **Pendente antes de publicar:** confirmar por escrito a titularidade do
> código do Convert3D para uso e modificação pela Smart Chain City / UZAACOM
> (doc 13 §5.2).
>
> Este é o único lugar que declara o estado da ferramenta. O `CLAUDE.md`
> aponta para cá. O `AUDITORIA.md` é histórico do Convert3D.

## Como ler

| #   | Documento                                                   | O que responde                                              |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| —   | [CLAUDE.md](CLAUDE.md)                                      | Regras e convenções. **Leia antes de escrever código**      |
| 01  | [Deploy](docs/01-DEPLOY.md)                                 | Instalação local (WAMP) e checklist de produção             |
| —   | [`deploy/`](deploy/README.md)                               | Contêiner da infraestrutura SCC                             |
| 02  | [Validação](docs/02-VALIDACAO.md)                           | O que conferir depois de instalar, no servidor e no browser |
| 03  | [Integração](docs/03-PHP_INTEGRATION.md)                    | JWT do gateway, API, `validate-lot` e SDK PHP               |
| 04  | [Guia de exportação](docs/04-EXPORT_GUIDE.md)               | Como exportar de cada software para o SCC Builder           |
| —   | [CHANGELOG.md](CHANGELOG.md) · [AUDITORIA.md](AUDITORIA.md) | O histórico e a análise que originou a v2 do Convert3D      |

---

## O que funciona hoje

Esta seção descreve o comportamento **implementado e testado**. Nada aqui é
roadmap.

| Recurso                                                                                      | Estado                                                           |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Editor 3D no browser (importar, editar, exportar)                                            | ✅                                                               |
| Conversão no servidor via API REST                                                           | ✅                                                               |
| **Preset `scc`**: Y-up, metros, Meshopt, LOD1/LOD2, `modelo.meta.json` (base, caixa/colisor) | ✅ no CLI e na API; no editor, eixo/escala e aviso de orçamento  |
| **Exportar para o mapa**: ajusta aos limites da plataforma e coloca o prédio no lote do mapa | ✅ (protótipo da cidade; o World ainda não existe)               |
| **`POST /api/validate-lot.php`**: recuo, gabarito, coeficiente/outorga, triângulos, escala   | ✅ (testes em `tests/php/`)                                      |
| **Login pelo JWT HS256 do gateway SCC**, escopo dos jobs por `account_id`                    | ✅                                                               |
| API key opcional servidor a servidor (com `X-Account-Id`)                                    | ✅                                                               |
| Publicação no bucket SCC: `builder/<account_id>/<model_id>/v<n>/modelo.glb`                  | ✅ (SigV4 próprio; S3, MinIO, R2) — sem teste contra bucket real |
| Otimização real (dedup, weld, join, simplify, Draco/Meshopt)                                 | ✅                                                               |
| Fila assíncrona com worker e persistência SQLite                                             | ✅                                                               |
| CORS allowlist, rate limiting                                                                | ✅                                                               |
| SDK PHP com retry e polling                                                                  | ✅                                                               |
| Parsing em Web Worker com progresso e cancelamento                                           | ✅                                                               |
| Otimização e LOD no browser                                                                  | ✅                                                               |
| Presets de exportação por engine (SCC, Unity, Unreal, Godot…)                                | ✅                                                               |
| Undo/redo, atalhos de teclado e navegação por teclado                                        | ✅                                                               |
| Editor de blocos (ocultar, excluir, isolar antes de exportar)                                | ✅                                                               |
| Texturização: triplanar sem UV, geração de UV, 12 materiais                                  | ✅                                                               |
| Camadas e divisão de malhas em peças soltas                                                  | ✅                                                               |
| Editor em português, espanhol e inglês                                                       | ✅                                                               |
| Miniatura PNG no servidor, _webhook_ para o World, KTX2                                      | ❌ ainda não (doc 13 §5.1)                                       |
| Geração de textura por IA                                                                    | ❌ exige GPU dedicada ([por quê](#texturização))                 |
| FBX / DAE no servidor                                                                        | ⚠️ requer FBX2glTF ou Assimp instalado                           |
| IFC / 3MF                                                                                    | ❌ não suportado ([por quê](#formatos))                          |

### Formatos

| Entrada                                | No browser            | No servidor               |
| -------------------------------------- | --------------------- | ------------------------- |
| `.glb` / `.gltf`                       | ✅ nativo (com Draco) | ✅ nativo                 |
| `.obj` (+ `.mtl`)                      | ✅ nativo             | ✅ nativo                 |
| `.stl`                                 | ✅ nativo             | ✅ nativo                 |
| `.ply`                                 | ✅ nativo             | ✅ nativo                 |
| `.fbx`                                 | ✅ nativo             | ⚠️ requer FBX2glTF/Assimp |
| `.dae` (Collada)                       | ✅ nativo             | ⚠️ requer Assimp          |
| `.ifc`, `.3mf`                         | ❌                    | ❌                        |
| `.rvt`, `.skp`, `.max`, `.pln`, `.3dm` | ❌ proprietários      | ❌                        |

Formatos proprietários (`.rvt` do Revit, `.skp` do SketchUp, `.max` do 3ds Max…)
não têm leitor público — só o software de origem os abre. Ao tentar importar um
deles, o SCC Builder mostra o passo a passo de exportação daquele software
específico em vez de um erro genérico.

**Saída:** `.glb` (recomendado) e `.gltf` no servidor; adicionalmente `.obj`,
`.stl` e `.ply` no browser.

> **Sobre IFC e 3MF:** a v1 listava esses formatos, mas nenhum loader existia —
> o upload era aceito e a conversão falhava. Foram removidos em vez de
> mantidos como promessa. Para BIM, exporte do Revit como FBX ou DAE.

### Resultados medidos

Esfera de teste com 32.400 triângulos, OBJ de 1,08 MB:

| Perfil       | Saída   | Redução   | Triângulos |
| ------------ | ------- | --------- | ---------- |
| `none`       | 2,33 MB | —         | 32.400     |
| `balanced`   | 49,6 KB | **95,4%** | 32.400     |
| `aggressive` | 39,2 KB | **96,4%** | 16.200     |

Arestas vivas são preservadas: um cubo importado sai com 24 vértices
(6 faces × 4 cantos), não 8 — as quinas não são suavizadas.

**Bundle inicial** (após o code-splitting e o tree-shaking dos ícones):

| Chunk             | Tamanho | gzip   | Quando carrega      |
| ----------------- | ------- | ------ | ------------------- |
| `index`           | 75 KB   | 26 KB  | sempre              |
| `vendor` (ícones) | 93 KB   | 29 KB  | sempre              |
| `three-core`      | 664 KB  | 180 KB | sempre              |
| `three-loaders`   | 169 KB  | 50 KB  | ao abrir um arquivo |
| `three-exporters` | 44 KB   | 13 KB  | ao exportar         |
| `jszip`           | 97 KB   | 30 KB  | no batch ZIP        |
| `parser.worker`   | 142 KB  | —      | worker, sob demanda |

Na v1 tudo isso era um único arquivo de 906 KB carregado de imediato.

---

## Instalação

### Caminho rápido

```bat
cd C:\wamp64\www\scc-builder
instalar.bat
```

Um comando faz tudo: dependências, chaves de API, `.env`, storage fora do
webroot, banco SQLite, build de produção e validação (~45 verificações).

Depois, **como Administrador**, registre o worker da fila:

```bat
bin\windows\worker-instalar.bat
```

Acesse `http://localhost/scc-builder/`.

O guia completo — incluindo domínio próprio, HTTPS e checklist de produção —
está em [`docs/01-DEPLOY.md`](docs/01-DEPLOY.md).

### Pré-requisitos

- Node.js 18+ e PHP 8.1+ (com `pdo_sqlite`, `curl` e `fileinfo`)
- Apache com `mod_rewrite` (e, de preferência, `mod_headers` e `mod_deflate`)
- _(opcional)_ [FBX2glTF](https://github.com/facebookincubator/FBX2glTF/releases)
  ou [Assimp](https://github.com/assimp/assimp) no PATH, para FBX/DAE no servidor

### Instalação manual

Se preferir controlar cada etapa, veja [`docs/01-DEPLOY.md`](docs/01-DEPLOY.md).
O instalador aceita parâmetros:

```bat
php bin\instalar.php --base=/3d/ --storage=D:\dados --forcar-chaves
```

### Verificação

```bat
validar.bat                REM tudo: servidor + lint + testes + build
php bin\validar.php        REM só o servidor
php bin\validar.php --skip-http
```

O validador não só confere configuração: ele **converte um cubo de verdade**
pelo pipeline, tenta subir um PHP disfarçado de `.obj` para provar que a
validação por magic bytes rejeita, e verifica se o banco SQLite está exposto
por HTTP.

---

## Uso

### Editor web

```bash
npm run dev      # http://localhost:5173/scc-builder/
```

Arraste **a pasta inteira** do modelo (não só o arquivo): o `.mtl`, o `.bin`
e as texturas são resolvidos automaticamente.

#### Atalhos

| Tecla               | Ação                                       |
| ------------------- | ------------------------------------------ |
| `W` / `E` / `R`     | Mover / Rotacionar / Escalar               |
| `Q`                 | Desativar o gizmo                          |
| `F` / `Shift+F`     | Enquadrar o ambiente / a seleção           |
| `+` / `−`           | Aproximar / afastar                        |
| `A`                 | Zoom por área (arrastar retângulo)         |
| `1` `2` `3` `4`     | Vista isométrica / topo / frente / lateral |
| `Z`                 | Alternar wireframe                         |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / Refazer                         |
| `H` / `Shift+H`     | Ocultar seleção / Mostrar tudo             |
| `I`                 | Isolar a seleção                           |
| `Delete`            | Excluir blocos selecionados                |
| `Esc`               | Fechar modais e cancelar o carregamento    |
| `?`                 | Lista de atalhos                           |

A árvore de hierarquia é navegável por teclado (setas, `Home`, `End`, `Enter`)
e segue o padrão WAI-ARIA de _treeview_.

#### Editor de blocos

Um estande de feira exportado do Lumion chega com mobiliário, vegetação e
luminárias que raramente devem ir para a engine. O painel **Blocos da cena**
resolve isso sem voltar ao software de origem:

- clique no **◉** ao lado de qualquer nó da árvore para ocultá-lo;
- `Ctrl+clique` seleciona vários blocos, `Shift+clique` seleciona o intervalo;
- **Isolar** mostra só a seleção; **Excluir** remove de vez (com `Ctrl+Z`);
- **Ocultar por material** esconde de uma vez tudo que usa determinado
  material — o caminho mais rápido para tirar a vegetação inteira.

O que está oculto **não entra no arquivo exportado**, em qualquer formato. O
painel mostra em tempo real quantos triângulos serão exportados, e a árvore
traz a contagem de cada bloco para você saber o que pesa.

#### Camadas e divisão de blocos

Exportações de Lumion e SketchUp costumam chegar com tudo em poucas malhas
gigantes e nomes como `Mesh`, `Mesh`, `Mesh` — impossível ocultar só as
cadeiras ou texturizar só o piso.

**Dividir** separa uma malha em peças:

| Modo               | Quando usar                                              |
| ------------------ | -------------------------------------------------------- |
| Peças soltas       | Separa ilhas de geometria — cada cadeira vira um objeto  |
| Grupos de material | Malha multi-material vira uma malha por material         |
| Fatias por eixo    | Casca contínua (fachada inteira) em pedaços gerenciáveis |

Use **Prever** antes: a divisão por peças soltas de uma malha muito
fragmentada pode gerar centenas de objetos.

**Camadas** reconstroem a organização perdida na exportação. O sistema
compara três estratégias — nome, material e hierarquia — e sugere a que
separa melhor este arquivo. "Organizar em camadas" reescreve a hierarquia,
então a árvore e a exportação passam a enxergar essa estrutura.

#### Texturização

Modelos de arquitetura chegam sem textura com frequência: ou o `.dae` veio
sem a pasta de imagens, ou o exportador não gravou coordenadas UV. O painel
**Texturas** resolve os dois casos.

O diagnóstico no topo informa quantas malhas têm UV. A partir daí:

| Situação           | Caminho                                           |
| ------------------ | ------------------------------------------------- |
| Sem UV nenhuma     | **Projeção triplanar** — dispensa UV, sem costura |
| Com UV do arquivo  | Usa o mapeamento original                         |
| Quer UV de verdade | Gerar cúbica, planar, cilíndrica ou esférica      |

A **triplanar** amostra a textura nos três planos do mundo e mistura pela
normal da superfície. É o único caminho quando não há UV — e é justamente
a limitação das ferramentas de textura por IA, que exigem mapeamento.

A **biblioteca** traz 12 materiais de arquitetura com parâmetros PBR
plausíveis (concreto, madeira, aço escovado, vidro, tijolo…), com texturas
procedurais geradas em canvas — sem peso no bundle e funcionando offline.

Você também pode enviar a própria imagem e ajustar a escala do ladrilho em
metros, com resultado ao vivo.

> **Sobre geração por IA:** ferramentas como o Hi3D geram textura com
> modelos de difusão rodando em GPU. Isso não roda em WAMP local — exige
> GPU dedicada e minutos por modelo. O SCC Builder cobre o lado que funciona
> no browser: aplicar e mapear texturas existentes.

#### Otimização e destino

O painel **Otimização** solda vértices e simplifica a malha no próprio browser,
com previsão do resultado antes de aplicar. **Gerar LOD** cria três níveis de
detalhe para cenas grandes.

O painel **Destino (engine)** resolve o problema clássico do modelo que chega
deitado ou 100× fora de escala: informe a unidade e o eixo vertical do arquivo
de origem, escolha o motor de destino e o preset aplica a rotação e a escala
corretas na exportação.

O preset **Smart Chain City** (padrão) é Y-up e metros, como o lote espera,
e avisa quando o modelo passa dos 300 mil triângulos.

| Motor                                              | Eixo vertical | Unidade    |
| -------------------------------------------------- | ------------- | ---------- |
| Smart Chain City / glTF / Unity / Three.js / Godot | Y-up          | metro      |
| Unreal Engine                                      | Z-up          | centímetro |
| Blender                                            | Z-up          | metro      |

### CLI

```bash
node bin/convert.js -i torre.fbx -o torre.glb --preset scc
node bin/convert.js -i casa.obj -o casa.glb --optimize aggressive
node bin/convert.js -i planta.stl -o planta.glb --flip-axis --scale 0.001
node bin/convert.js --help
```

Com `--preset scc`, o LOD0 é simplificado até 240 mil triângulos quando passa
de 300 mil, e saem, ao lado do `torre.glb`: `torre-lod1.glb` (25% do LOD0),
`torre-lod2.glb` (5%) e `torre.meta.json` — contorno convexo da
base, até 6 mil pontos da projeção no chão, caixa (que serve de colisor),
altura e triângulos. A compressão é Meshopt no lugar do Draco: decodifica mais
rápido quando a cidade carrega dezenas de prédios.

### API REST

Todo endpoint exige **`Authorization: Bearer <JWT SCC>`** (jogador; claims
`sub` = `account_id` e `exp`) ou, servidor a servidor, `X-API-Key` (com
`X-Account-Id` para agir em nome de um jogador). Cada jogador só enxerga os
próprios jobs.

| Método   | Endpoint                        | Descrição                                                                 |
| -------- | ------------------------------- | ------------------------------------------------------------------------- |
| `POST`   | `/api/convert.php`              | Envia arquivo (`preset=scc` por padrão, `model_id` opcional); devolve job |
| `POST`   | `/api/validate-lot.php`         | Confere o job contra o polígono e as regras do lote                       |
| `GET`    | `/api/jobs.php?job_id=…`        | Status de um job                                                          |
| `GET`    | `/api/jobs.php?status=…&page=1` | Lista paginada                                                            |
| `GET`    | `/api/models.php?action=list`   | Modelos convertidos                                                       |
| `GET`    | `/api/download.php?job_id=…`    | Baixa o arquivo                                                           |
| `DELETE` | `/api/models.php?job_id=…`      | Remove modelo e arquivos                                                  |
| `GET`    | `/api/health.php`               | Diagnóstico da instalação                                                 |

```bash
curl -X POST http://localhost/scc-builder/api/convert.php \
  -H "Authorization: Bearer $JWT" \
  -F "file=@torre.fbx" -F "model_id=mdl_torre_a1"

curl -X POST http://localhost/scc-builder/api/validate-lot.php \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"job_id":"job_a1b2","lot":{"id":"A1-078","polygon":[[0,0],[50,0],[50,50],[0,50]],"setback_m":3,"max_height_m":160,"far":6},"transform":{"rotation_deg":0,"units":"m"}}'
```

Resposta do `validate-lot` (formato do doc 13 §5.3):

```jsonc
{
  "status": "success",
  "data": {
    "valid": true,
    "checks": [
      { "code": "scale", "ok": true, "value": 80.8, "min": 2, "max": 400 },
      { "code": "fits_setback", "ok": true, "setback_m": 3, "outside": 0, "points": 44 },
      { "code": "height", "ok": true, "value": 80.8, "max": 160 },
      {
        "code": "far",
        "ok": false,
        "severity": "fee",
        "gfa_m2": 8500,
        "max_m2": 7500,
        "outorga_scity": 2500,
      },
      { "code": "triangles", "ok": true, "value": 84320, "max": 300000 },
    ],
    "footprint": { "hull": [[15, 15], "…"], "area_m2": 400 },
    "suggested_floors": 25,
    "placement": { "position": [25, 25], "rotation_deg": 0, "scale": 1 },
    "artifacts": {
      "glb": "builder/0xabc…/mdl_torre_a1/v1/modelo.glb",
      "lod1": "…",
      "lod2": "…",
      "meta": "…",
      "thumb": null,
    },
  },
}
```

Como cada regra é conferida:

| Check          | Regra                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fits_setback` | Todo ponto da base (projeção dos vértices, já girada e posicionada) dentro do lote **e** a pelo menos `setback_m` de todas as divisas — o polígono reduzido exato, que vale também para lote em L |
| `height`       | Altura da caixa ≤ `max_height_m` (gabarito)                                                                                                                                                       |
| `far`          | Área construída = área do contorno × 0,85 × andares, contra área do lote × `far`. Passar **não reprova**: vira `severity: "fee"` com a outorga onerosa (2,5 SCITY/m² excedente)                   |
| `triangles`    | ≤ 300 mil                                                                                                                                                                                         |
| `scale`        | Altura entre 2 e 400 m — pega o modelo em milímetros lido como metros                                                                                                                             |

Andares sugeridos: altura ÷ pé-direito de 3,2 m. Pé-direito, eficiência,
taxa da outorga e limites ficam em `lot_*` na configuração. Sem `position`, o
prédio vai para o centroide do lote. O resultado não é gravado: quem guarda a
validação aprovada é o serviço World.

Erros trazem `error.code` estável (`missing_credentials`, `invalid_token`,
`token_expired`, `invalid_polygon`, `meta_missing`, `file_too_large`,
`rate_limited`…), mensagem e `request_id` para correlacionar com
`storage/logs/api-AAAA-MM-DD.jsonl`.

### Exportar para o mapa

O botão **Exportar para o mapa**, abaixo de "Baixar arquivo convertido", leva o
modelo do editor direto para o lote do jogador no mapa da Smart Chain City:

1. aplica o preset `scc` com a unidade e o eixo do painel **Destino** (Y-up,
   metros) e omite os blocos ocultos;
2. **ajusta ao tamanho que a plataforma aceita** (doc 13 §9 e §13.3), com o
   mesmo código do servidor (`src/utils/sccPlatform.js`):

   | Limite             | Valor                  | O que o ajuste faz                                                                                    |
   | ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------- |
   | Triângulos do LOD0 | 300 mil                | simplifica até 240 mil                                                                                |
   | LOD1 / LOD2        | 25% / 5% do LOD0       | gera, só com posições                                                                                 |
   | Texturas           | 2048 px                | reduz no canvas                                                                                       |
   | Envio              | 40 MB (3 LODs somados) | Meshopt + quantização; se ainda passar, tenta de novo com texturas e triângulos menores (até 4 vezes) |
   | Materiais          | 8 por prédio           | avisa                                                                                                 |

3. abre o mapa e entrega os três LODs por `postMessage` (o arquivo vai de
   uma aba para a outra, sem rede). O mapa entra no modo **Construtor**, põe o
   prédio no lote e roda a validação; a resposta volta para o editor.

Medido no browser: plano de 400 mil triângulos com textura de 4096 px, 11 MB →
LOD0 240 mil, LOD1 60 mil, LOD2 12 mil, textura de 2048 px, **1,4 MB** em 3,7 s.

O endereço do mapa vem de `VITE_SCC_MAP_URL`; em desenvolvimento, sem ela, é
o protótipo em `http://localhost:8081/docs/proposta-cidade-realista/index.html`.
O mapa só aceita mensagens das origens listadas em `BUILDER_ORIGINS`, no
`main.js` dele — acrescente lá o domínio de produção do SCC Builder.

### Editor e o JWT

O jogo abre o editor com `https://<host>/#token=<jwt>`. O fragmento não vai
ao servidor; o editor o guarda no `sessionStorage` da aba e o manda em
`Authorization: Bearer`. Em desenvolvimento, `VITE_SCC_TOKEN` (gerado por
`php bin/token-dev.php <account_id>`) ou `VITE_API_KEY` no `.env`.

### SDK PHP

```php
require 'sdk/SccBuilder.php';

use SccBuilder\SccBuilderClient;
use SccBuilder\SccBuilderException;

// Servidor a servidor (serviço World): API key
$client = new SccBuilderClient('http://localhost/scc-builder/api', 'sua-chave');

try {
    $job = $client->convertAndWait('torre.obj', [
        'optimize' => SccBuilderClient::OPTIMIZE_BALANCED,
    ]);

    $client->downloadTo($job['id'], 'saida/torre.glb');
} catch (SccBuilderException $e) {
    echo $e->getUserMessage();
}
```

---

## Estrutura

```
tools/scc-builder/
├── src/                     Frontend (editor 3D)
│   ├── viewer.js            Motor Three.js, gizmo, slicer, picking, colisores
│   ├── converter.js         Loaders/exporters com import dinâmico
│   ├── api/client.js        Cliente da API REST (JWT do jogador)
│   ├── i18n/                Português (chave), en.js, es.js
│   ├── ui/                  hierarchyTree (virtualizada), icons
│   ├── workers/             parser.worker — OBJ/STL/PLY fora da main thread
│   └── utils/               geometry, materials, optimizer, history,
│                            enginePresets (inclui "scc"), parseClient…
│
├── api/                     API REST PHP
│   ├── config.php           Bootstrap, autoload, tratamento de erros
│   ├── config.local.php     Segredos (NÃO versionado)
│   ├── convert.php · validate-lot.php · jobs.php · models.php · download.php · health.php
│   └── lib/                 Security, Jwt, LotValidator, S3Publisher,
│                            FileValidator, Storage, JobRepository…
│
├── bin/
│   ├── convert.js           CLI de conversão (--preset scc)
│   ├── worker.php           Worker da fila
│   ├── token-dev.php        JWT de desenvolvimento
│   └── lib/                 pipeline, optimize, footprint, mesh-import, gltf-build
│
├── sdk/SccBuilder.php       SDK PHP
├── deploy/                  Dockerfile e vhost do contêiner
├── tests/                   Vitest + php/ (JWT, validate-lot, HTTP) + e2e/ (Playwright)
└── storage/                 Uploads, convertidos, logs, SQLite (não versionado)
```

---

## Desenvolvimento

```bash
npm run dev            # editor em http://localhost:5173/scc-builder/
npm test               # Vitest
npm run test:php       # JWT, validate-lot e o endpoint por HTTP (php -S)
npm run lint           # ESLint (zero warnings permitidos)
npm run format         # Prettier
npm run check          # lint + format + testes + build
```

O `test:php` usa o `php` do PATH, que precisa de `pdo_sqlite` (o do WAMP tem).

---

## Segurança

- JWT HS256 do gateway SCC em todo endpoint: só HS256 (o `alg` do token não é
  obedecido), `exp` obrigatório, `iss`/`aud` conferidos quando configurados,
  `sub` restrito a caracteres seguros — ele vira pasta no bucket
- API key opcional, comparada com `hash_equals`, só para servidor a servidor
- CORS por allowlist explícita; `*` só com `allow_public` ativo
- Rate limiting por identidade + IP, com janela configurável
- Validação de upload por **magic bytes**, não só pela extensão
- Storage fora do webroot; quando isso não é possível, `.htaccess` desliga o
  motor PHP e nega acesso direto
- Downloads mediados por `download.php`, com proteção contra path traversal
- Escopo por dono: cada `account_id` só enxerga os próprios jobs
- Logs estruturados em JSONL com `request_id`

Encontrou uma vulnerabilidade? Veja o [SECURITY.md](../../SECURITY.md) do monorepo.

---

## Histórico

**v0.1.0 (SCC Builder)** — derivado do Convert3D v2.8.0: identidade pelo JWT
do gateway SCC, escopo por `account_id`, bucket SCC próprio, preset `scc`,
`validate-lot` e deploy em contêiner.

Detalhes em [`CHANGELOG.md`](CHANGELOG.md); a análise que originou a v2 do
Convert3D está em [`AUDITORIA.md`](AUDITORIA.md).

## Licença

MIT — veja [LICENSE](LICENSE).
