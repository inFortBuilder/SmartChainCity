# Deploy do SCC Builder

O SCC Builder roda num **contêiner próprio** na infraestrutura da Smart Chain
City ([trilha infra](../../../docs/desenvolvimento/trilha-infra.md)). Não
depende de nenhuma outra aplicação: a identidade vem do JWT do gateway SCC e
o armazenamento é o bucket SCC.

## Imagem

```bash
docker build -f deploy/Dockerfile -t scc-builder .
```

A mesma imagem serve a API (Apache, padrão) e o worker da fila
(`php bin/worker.php --sleep=2`). Os dois montam o mesmo volume em
`/var/lib/scc-builder` (SQLite, uploads, convertidos, logs).

## Variáveis de ambiente

Toda chave de `api/lib/Config.php` aceita `SCC_BUILDER_<CHAVE>`.

| Variável                                                                | Obrigatória  | O que é                                                        |
| ----------------------------------------------------------------------- | ------------ | -------------------------------------------------------------- |
| `SCC_BUILDER_JWT_SECRET`                                                | sim          | Segredo HS256 do gateway SCC (o mesmo que assina o login SIWE) |
| `SCC_BUILDER_JWT_ISSUER` / `SCC_BUILDER_JWT_AUDIENCE`                   | recomendado  | Conferidos quando definidos                                    |
| `SCC_BUILDER_API_KEYS`                                                  | para o World | Chaves servidor a servidor, separadas por vírgula              |
| `SCC_BUILDER_CORS_ORIGINS`                                              | sim          | Origens do cliente web do jogo, separadas por vírgula          |
| `SCC_BUILDER_S3_ENABLED`                                                | —            | `true` publica no bucket                                       |
| `SCC_BUILDER_S3_BUCKET`, `_S3_REGION`, `_S3_ENDPOINT`, `_S3_PATH_STYLE` | com S3       | Bucket SCC; endpoint para MinIO/R2                             |
| `SCC_BUILDER_S3_KEY` / `_S3_SECRET`                                     | com S3       | Ou `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`               |
| `SCC_BUILDER_S3_URL_BASE`                                               | —            | CDN pública dos modelos                                        |

Layout no bucket: `builder/<account_id>/<model_id>/v<n>/modelo.glb`, com
`modelo-lod1.glb`, `modelo-lod2.glb` e `modelo.meta.json` ao lado.

> Variáveis com lista (`API_KEYS`, `CORS_ORIGINS`) chegam como lista simples:
> as chaves recebem índice numérico (`key0`, `key1`…) nos logs.

## Depois de subir

```bash
docker exec <contêiner> php bin/validar.php --skip-http
curl -s https://<host>/api/health.php
```

O `bin/validar.php` confere o segredo do JWT, o storage fora do webroot e
converte um cubo de verdade pelo pipeline.

## O que ainda não está no contêiner

- Miniatura PNG renderizada no servidor e _webhook_ para o World (doc 13 §5.1).
- Compressão de textura KTX2 (exige o `toktx` na imagem).
