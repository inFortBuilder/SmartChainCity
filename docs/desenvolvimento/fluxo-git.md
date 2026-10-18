# Fluxo de Git e GitHub

## Branches

| Branch | Uso | Regras |
|--------|-----|--------|
| `main` | Sempre implantável em staging | Protegida: só via PR, CI verde, 1 aprovação (2 para `contracts/`) |
| `release/x.y` | Estabilização antes de produção | Só correções |
| `feat/<trilha>-<issue>-<resumo>` | Funcionalidade | Ex.: `feat/backend-42-work-shift` |
| `fix/<trilha>-<issue>-<resumo>` | Correção | Ex.: `fix/client-77-cell-unload` |
| `chore/…`, `docs/…` | Manutenção e documentação | — |

Fluxo *trunk-based*: branches curtas (até ~3 dias), PRs pequenos e *feature flags* para o que não está pronto.

## Commits — Conventional Commits

```
<tipo>(<escopo>): <resumo no imperativo>

tipos: feat · fix · docs · refactor · test · chore · perf · ci · build
escopos: client · backend · game-core · economy · world · realtime · indexer · cms · contracts · metaverse · tools · infra · art
```

Exemplos: `feat(game-core): agendar fim do turno de trabalho` · `fix(contracts): validar deadline do voucher`.

## Pull Requests

- Vincular a issue (`Closes #42`).
- Preencher o [modelo de PR](../../.github/pull_request_template.md): o que mudou, como testar, impacto na economia, impacto em contratos.
- Mudanças em **contratos**, **ledger** ou **regras de economia** exigem revisão de um responsável da trilha (ver `.github/CODEOWNERS`).
- Prefira *squash merge*.

## Issues, rótulos e milestones

| Rótulo | Significado |
|--------|-------------|
| `epic` | Épico do roadmap (E0.1, E1.4…) |
| `task`, `bug`, `spike` | Tipo |
| `track:client`, `track:backend`, `track:contracts`, `track:cms`, `track:metaverse`, `track:econ`, `track:infra`, `track:art`, `track:legal` | Trilha |
| `prio:P0` … `prio:P3` | Prioridade |
| `security` | Segurança (tratar com discrição — ver [SECURITY.md](../../SECURITY.md)) |
| `needs-adr` | Precisa de decisão registrada |

Milestones: `M0-fundacao`, `M1-vertical-slice`, `M2-alpha`, `M3-beta`, `M4-lancamento`, `M5-liveops-*`.

Quadro sugerido no GitHub Projects: **Backlog → Pronto para dev → Em andamento → Em revisão → Feito**, com campos *Etapa*, *Trilha* e *Sprint*.

## Versionamento e releases

- SemVer por componente (`client-unity` segue `0.x` até o lançamento; o build legado era 0.0.23).
- Tags: `client-v0.1.0`, `game-core-v0.1.0`, `contracts-v1.0.0`.
- Contratos implantados: endereços registrados em `contracts/deployments/<rede>.json` no mesmo PR da tag.

## Arquivos grandes (LFS)

Texturas, modelos, áudio, vídeo e `.unitypackage` são versionados com **Git LFS** (ver `.gitattributes`). Builds WebGL **não** vão para o repositório: são publicados como artefatos do CI.
