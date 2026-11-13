# infra

Infraestrutura como código (AWS), Docker Compose de desenvolvimento e runbooks.

```
infra/
├─ docker/      ← docker-compose.dev.yml
├─ observability/ ← Prometheus + Grafana local, painel por serviço (E1.7)
├─ terraform/   ← ou cdk/, conforme ADR
└─ runbooks/    ← incidentes, deploy, rotação de chaves
```

Guia: [docs/desenvolvimento/trilha-infra.md](../docs/desenvolvimento/trilha-infra.md)
