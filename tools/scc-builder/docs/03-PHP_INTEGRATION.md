# 03 — Integração com o jogo: JWT, API, validate-lot e SDK

Como o jogo e os serviços da Smart Chain City conversam com o SCC Builder.
O contrato está no [doc 13 §5.3](../../../docs/13-cidade-realista-construtores.md).

```
 Cliente do jogo ──(link com #token=<jwt>)──▶ Editor SCC Builder
        │                                         │ Authorization: Bearer <jwt>
        │                                         ▼
        │                                  API SCC Builder ──▶ bucket SCC
        │                                         ▲          builder/<account_id>/<model_id>/v<n>/
 Serviço World ──(X-API-Key + X-Account-Id)───────┘
```

---

## 1. Autenticação

### JWT do gateway (jogador)

O gateway SCC emite o JWT no login SIWE ([doc 05 §4](../../../docs/05-arquitetura-tecnica.md)).
O SCC Builder só **confere**; não emite em produção.

| Item                 | Regra                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Header               | `Authorization: Bearer <jwt>`                                                                |
| Algoritmo            | **HS256**, fixo no servidor. Token com outro `alg` (inclusive `none`) é recusado             |
| Segredo              | `jwt_secret` em `api/config.local.php` ou `SCC_BUILDER_JWT_SECRET` — o mesmo do gateway      |
| `sub`                | `account_id` do jogador. Só `A-Z a-z 0-9 _ . : -`, até 128 caracteres (vira pasta no bucket) |
| `exp`                | Obrigatório. Tolerância de relógio: `jwt_leeway` (30 s)                                      |
| `nbf`, `iat`         | Conferidos quando presentes                                                                  |
| `iss`, `aud`         | Conferidos quando `jwt_issuer` / `jwt_audience` estão definidos                              |
| `builder_company_id` | Opcional: empresa construtora, gravada no job                                                |

Erros: `missing_credentials` (401), `invalid_token` (401), `token_expired` (401).

### API key (servidor a servidor)

Para o serviço World e scripts internos: `X-API-Key: <chave>` (ou
`Authorization: Bearer <chave>`, que não tem formato de JWT). Com
`X-Account-Id: <account_id>` a chave age em nome daquele jogador; sem ele, os
jobs ficam no escopo da própria chave (`key:<nome>`).

> A API key **nunca** vai para o browser de produção: o `VITE_API_KEY` fica
> embutido no JavaScript. No editor, só em desenvolvimento local.

### Abrindo o editor a partir do jogo

```
https://builder.<domínio>/#token=<jwt>
```

O fragmento (`#…`) não é enviado ao servidor nem aparece no log de acesso. O
editor lê o token uma vez, tira da barra de endereço e o guarda no
`sessionStorage` da aba. Para testar sem o gateway:

```bash
php bin/token-dev.php 0xSuaCarteira 120   # token de 120 minutos com o jwt_secret local
```

---

## 2. Endpoints

| Método   | Endpoint                      | Para quê                                                      |
| -------- | ----------------------------- | ------------------------------------------------------------- |
| `POST`   | `/api/convert.php`            | Envia o modelo; devolve o job (201 síncrono, 202 enfileirado) |
| `GET`    | `/api/jobs.php?job_id=…`      | Status e métricas                                             |
| `POST`   | `/api/validate-lot.php`       | Confere o modelo convertido contra o lote                     |
| `GET`    | `/api/download.php?job_id=…`  | GLB convertido                                                |
| `GET`    | `/api/models.php?action=list` | Modelos do jogador                                            |
| `DELETE` | `/api/models.php?job_id=…`    | Remove modelo e arquivos                                      |
| `GET`    | `/api/health.php`             | Diagnóstico (detalhes só com API key)                         |

Envelope de toda resposta:

```json
{ "status": "success", "data": { … }, "request_id": "3f2a1b0c9d8e7f6a" }
{ "status": "error", "error": { "code": "invalid_polygon", "message": "…", "details": {} }, "request_id": "…" }
```

### `POST /api/convert.php`

`multipart/form-data`:

| Campo          | Padrão            |                                                                                                       |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| `file`         | —                 | Obrigatório. `.glb .gltf .obj .stl .ply .fbx .dae`                                                    |
| `preset`       | `scc`             | `scc` gera Meshopt, LOD1/LOD2 e `modelo.meta.json` (exigido pelo validate-lot). `none` = só conversão |
| `model_id`     | `mdl_<aleatório>` | Mesmo `model_id` do mesmo jogador → nova versão (`v2`, `v3`…)                                         |
| `optimize`     | `balanced`        | `none`, `balanced`, `aggressive`                                                                      |
| `flip_axis`    | `false`           | Z-up (CAD/BIM) → Y-up                                                                                 |
| `scale`        | `1`               | Multiplicador aplicado na conversão                                                                   |
| `external_ref` | —                 | Referência livre (ex.: id do lote no World)                                                           |
| `async`        | `false`           | Força a fila mesmo em arquivo pequeno                                                                 |

O job devolvido traz `owner` (o `account_id`), `model_id`, `version`,
`triangles_after` e, com o bucket ligado, `s3_keys`.

### `POST /api/validate-lot.php`

```json
{
  "job_id": "job_a1b2…",
  "lot": {
    "id": "A1-078",
    "polygon": [
      [0, 0],
      [50, 0],
      [50, 50],
      [0, 50]
    ],
    "setback_m": 3,
    "max_height_m": 160,
    "far": 6.0
  },
  "transform": { "rotation_deg": 0, "units": "m", "position": [25, 25] }
}
```

- `polygon`: vértices `[x, z]` em metros, 3 a 1000; anel fechado (GeoJSON) é aceito.
- `units`: `m`, `cm`, `mm`, `in`, `ft` — a unidade em que o modelo foi desenhado.
- `position`: opcional; sem ele, o centro da base vai para o centroide do lote.
- O modelo é centralizado em XZ e apoiado no chão antes de girar, como no
  protótipo da cidade.

Resposta: `valid`, `checks[]`, `footprint { hull, area_m2 }`,
`suggested_floors`, `placement` e `artifacts` (chaves do bucket). O exemplo
completo e a regra de cada check estão no [README](../README.md#api-rest).

`valid` é `false` se algum check reprovar — exceto `far`, que, acima do
coeficiente, vem com `severity: "fee"` e `outorga_scity`: o jogador pode
construir pagando a outorga onerosa (doc 13 §4.1).

| Erro                                                     | HTTP | Quando                                             |
| -------------------------------------------------------- | ---- | -------------------------------------------------- |
| `not_found`                                              | 404  | Job de outro jogador, ou inexistente               |
| `job_not_completed`                                      | 409  | Ainda na fila                                      |
| `meta_missing`                                           | 409  | Convertido com `preset=none`: reconverta com `scc` |
| `invalid_polygon`, `invalid_units`, `invalid_setback_m`… | 400  | Entrada malformada                                 |

---

## 3. SDK PHP — `SccBuilderClient`

Para serviços PHP (o World, se for PHP, ou scripts de operação).

```php
require 'sdk/SccBuilder.php';

use SccBuilder\SccBuilderClient;
use SccBuilder\SccBuilderException;

// Servidor a servidor, em nome de um jogador
$client = new SccBuilderClient('https://builder.exemplo/api', getenv('SCC_BUILDER_KEY'), [
    'account_id' => '0xabc…',
]);

// Ou com o JWT do próprio jogador
// $client = new SccBuilderClient('https://builder.exemplo/api', '', ['token' => $jwt]);

try {
    $job = $client->convertAndWait('/tmp/torre.fbx', ['preset' => 'scc', 'model_id' => 'mdl_torre']);

    $resultado = $client->validateLot($job['id'], [
        'id'           => 'A1-078',
        'polygon'      => [[0, 0], [50, 0], [50, 50], [0, 50]],
        'setback_m'    => 3,
        'max_height_m' => 160,
        'far'          => 6.0,
    ], ['rotation_deg' => 0, 'units' => 'm']);

    if ($resultado['valid']) {
        // guardar o resultado no World e seguir para o alvará
    }
} catch (SccBuilderException $e) {
    error_log($e->getErrorCode() . ': ' . $e->getUserMessage());
}
```

Opções do construtor: `timeout` (30 s), `upload_timeout` (900 s),
`max_retries` (2, com backoff exponencial em 429/5xx), `verify_ssl`,
`token`, `account_id`.

---

## 4. Do browser (JavaScript)

O editor usa `src/api/client.js`:

```js
import { apiClient } from './api/client.js';

const { job } = await apiClient.convert(arquivo, { preset: 'scc', modelId: 'mdl_torre' });
const pronto = await apiClient.waitForJob(job.id);
const resultado = await apiClient.validateLot(pronto.id, lote, { rotation_deg: 0, units: 'm' });
```

---

## 5. Limites do PHP

Para modelos grandes, ajuste o `php.ini` (o contêiner de `deploy/` já vem assim):

```ini
upload_max_filesize = 512M
post_max_size       = 512M
memory_limit        = 512M
max_execution_time  = 300
```
