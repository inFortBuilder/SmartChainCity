# services/realtime

Multiplayer da cidade (E2.7, [ADR-0005](../../docs/adr/0005-multiplayer-colyseus.md)): presença, chat moderado e eventos ao vivo, em Colyseus 0.18 por WebSocket.

O jogo é assíncrono. Esta sala só mostra quem está por perto e o que dizem; saldo, posse e atributos continuam nos outros serviços (ADR-0002).

- Guia: [trilha-backend.md](../../docs/desenvolvimento/trilha-backend.md) (passo 14)

## O que funciona hoje

| Regra | Como |
|---|---|
| Uma sala por bairro | A ADR-0005 previa uma sala por célula da grade antiga. Com a cidade real ([ADR-0012](../../docs/adr/0012-cidade-real-construtores.md)), a unidade é o bairro, a mesma que o mapa usa para carregar os lotes. Entrar: `joinOrCreate('district', { city, district, name, x, z })` |
| Lotação | Até `MAX_CLIENTS` (100, doc 05 §4) por instância. Lotada, o matchmaker abre outra sala do mesmo bairro (`filterBy(['city', 'district'])`) |
| Login | O token do gateway (`client.auth.token`), conferido com o mesmo `JWT_SECRET`. Sem token válido, não entra |
| Presença | Estado sincronizado `players`: nome (moderado), `x`, `z`, `rot`, `mode` (`map` ou `street`), `speed` (m/s no street view, até 10) e `skin` (avatar `man` ou `human`). Movimento por `move`, até 10 por segundo; fora do mapa é ignorado. No mapa, cada jogador aparece como alfinete; no street view, quem também está na rua aparece como avatar, com a animação pela velocidade |
| Chat | `chat` com `{text}`, até 200 caracteres e 1 por segundo (rajada de 3). Detalhes abaixo |
| Denúncia | `report` com `{sessionId, reason}`. 3 contas diferentes silenciam o alvo por 15 min |
| Eventos | `POST /internal/v1/broadcast` (`x-service-token` = `INTERNAL_TOKEN`) manda `{kind, text}` para todas as salas, ou só as de uma cidade. É o dirigível de promoções (doc 08) e os avisos da Prefeitura |
| Movimento da cidade | `GET /v1/realtime/rooms`: jogadores e salas por bairro |

### Chat moderado (doc 10)

- **Links recusados:** links e convites (http, www, domínios, `t.me`, `discord.gg`) não passam. É o golpe mais comum num jogo com token.
- **Palavrões mascarados:** viram asteriscos, inclusive com acento ou letra repetida ("puuuta"), e a mensagem passa.
- **Silenciamento:** 3 mensagens recusadas em 10 minutos silenciam a conta por 10 minutos.
- **Respostas ao autor:** `chat_error` com `reason` = `link`, `too_long`, `empty`, `too_fast` ou `muted`.
- **Log de auditoria:** `chat.blocked`, `chat.masked` e `chat.report`.

A lista de palavras é curta de propósito (MVP); a versão final deve vir do CMS, por idioma.

### Carga (critério da trilha: 100 clientes por sala)

```bash
pnpm --filter @scc/realtime load
```

O script sobe o servidor no próprio processo, conecta 100 clientes no mesmo bairro e faz 99 deles andarem 5 vezes por segundo durante 10 s. Um observador mede quanto cada movimento leva para chegar até ele.

Resultado em 2026-11-20, nesta máquina:
- os 100 clientes ficaram numa sala só e entraram em 0,7 s;
- foram 495 movimentos por segundo;
- o atraso foi p50 de 41 ms, p95 de 72 ms e máximo de 83 ms;
- ninguém caiu.

Com `--url http://127.0.0.1:8050`, o teste roda contra um servidor no ar; precisa do mesmo `JWT_SECRET`.

## Rodar

Copie o `.env.example` para `.env` e use o mesmo `JWT_SECRET` do gateway:

```bash
cp services/realtime/.env.example services/realtime/.env
```

```bash
pnpm --filter @scc/realtime dev
```

Testes: a moderação pura, e o servidor de verdade com clientes do SDK por WebSocket.

```bash
pnpm --filter @scc/realtime test
```

## Ainda não

- Avatar andando no mapa: hoje a posição é para onde a câmera olha ([mapa de Pittsburg](../../docs/proposta-cidade-realista/README.md), que já mostra os outros jogadores e o chat).
- Redis presence para mais de um processo (doc 05 §4); hoje o matchmaker é local.
- Silenciamentos guardados em banco: hoje ficam na memória do processo.
- Corridas e eventos com agenda (o dirigível 3×/dia chama o broadcast, mas ainda não tem agendador).
