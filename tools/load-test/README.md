# load-test

Carga da API (E3.9): `api.mjs`, sem dependências (Node 24).

```bash
LOAD_JWT_SECRET=<JWT_SECRET dos serviços> node tools/load-test/api.mjs --rate 1000 --seconds 30
```

A carga do Realtime está no próprio serviço: `pnpm --filter @scc/realtime load:city`. O método, as opções e os resultados estão em [docs/desenvolvimento/teste-de-carga.md](../../docs/desenvolvimento/teste-de-carga.md).
