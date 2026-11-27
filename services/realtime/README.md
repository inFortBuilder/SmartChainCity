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
| Interior | Sala `interior`, uma por lote (`city`, `lot`). Só entra quem o world deixa visitar o imóvel: o realtime pergunta com o próprio token do jogador (`GET /v1/world/cities/:city/lots/:lot/visit`, `WORLD_URL`). Estado: nome, posição, tipo de avatar (`skin`), papel (`owner` ou `guest`) e `pose` (`idle`, `walk`, `run`, `sit`, `interact`, `talk`). O chat tem a mesma moderação do bairro. Até 25 por sala |
| Presença | Estado sincronizado `players`: nome (moderado), `x`, `z`, `rot`, `mode` (`map` ou `street`), `speed` (m/s no street view, até 10) e `skin` (avatar `man` ou `woman`). Movimento por `move`, até 10 por segundo; fora do mapa é ignorado. No mapa, cada jogador aparece como alfinete; no street view, quem também está na rua aparece como avatar, com a animação pela velocidade |
| Chat | `chat` com `{text}`, até 200 caracteres e 1 por segundo (rajada de 3). Detalhes abaixo |
| Denúncia | `report` com `{sessionId, reason}`. 3 contas diferentes silenciam o alvo por 15 min |
| Eventos | `POST /internal/v1/broadcast` (`x-service-token` = `INTERNAL_TOKEN`) manda `{kind, text}` para todas as salas, ou só as de uma cidade. É o dirigível de promoções (doc 08) e os avisos da Prefeitura |
| Movimento da cidade | `GET /v1/realtime/rooms`: jogadores e salas por bairro |

### Agenda de eventos ao vivo (doc 08, E3.10)

O realtime manda sozinho os eventos da agenda (`src/schedule.ts`) para todas as salas de bairro do processo:
- **Dirigível da Prefeitura:** 3 vezes por dia, às 10, 15 e 20 h no fuso da cidade (`EVENTS_UTC_OFFSET_MIN`, padrão −180, Brasília). O texto é o evento da semana do game-core (`GAME_CORE_URL`; na máquina local, a porta padrão). Sem o game-core, sai um aviso da Prefeitura.
- **Datas marcadas:** Ano Novo, Carnaval (a terça, pela Páscoa) e Natal, com um anúncio ao meio-dia. Os efeitos de jogo dessas datas ficam para o game designer.
- Cada evento tem uma chave e sai uma vez. O processo confere a cada `EVENTS_TICK_SECONDS` (30). O que passou há mais de 5 minutos (o processo estava fora) não sai atrasado.
- `GET /v1/realtime/schedule` lista as próximas 48 h. O chat do bairro no mapa mostra o próximo evento. Desligue com `EVENTS_ENABLED=false`.
- Com vários processos, cada um manda para as próprias salas, como o broadcast.
- **Premissas:** os horários, o fuso fixo (sem horário de verão) e os textos.

### Chat moderado (doc 10)

- **Links recusados:** links e convites (http, www, domínios, `t.me`, `discord.gg`) não passam. É o golpe mais comum num jogo com token.
- **Palavrões mascarados:** viram asteriscos, inclusive com acento ou letra repetida ("puuuta"), e a mensagem passa.
- **Silenciamento:** 3 mensagens recusadas em 10 minutos silenciam a conta por 10 minutos.
- **Respostas ao autor:** `chat_error` com `reason` = `link`, `too_long`, `empty`, `too_fast` ou `muted`.
- **Log de auditoria:** `chat.blocked`, `chat.masked` e `chat.report`.

A lista de palavras é curta de propósito (MVP); a versão final deve vir do CMS, por idioma.

### Vários processos, divididos por bairro (E3.9)

Um processo do realtime chega a um núcleo com cerca de 10 mil jogadores. Como cada sala é de um bairro (ou do interior de um lote), vários processos dividem a cidade sem compartilhar estado:
- cada processo sobe com `SHARD=i/n` (0/3, 1/3, 2/3) e recusa o bairro de outro com `421 wrong_shard`;
- o mapa recebe a lista dos processos em `?realtime=a,b,c` (ou `window.SCC_REALTIME`), na mesma ordem dos índices.

A regra é a mesma nos dois lados: FNV-1a de 32 bits de `cidade:bairro` (no interior, `cidade:lote:N`), módulo o número de processos. Está em [src/shard.ts](src/shard.ts) e em [realtime-shard.js](../../docs/proposta-cidade-realista/realtime-shard.js), e o teste confere que dão igual. Sem `SHARD`, o processo cuida de tudo (como antes).

`POST /internal/v1/broadcast` vale para as salas do próprio processo: um evento global vai para cada um.

### Carga da cidade (E3.9: 10 mil simultâneos)

`pnpm --filter @scc/realtime load:city` espalha os clientes por bairros de 100. Os clientes rodam em threads, entram em rampa e podem ir para vários processos (`--urls a,b,c`: o bairro `d` vai para o `d % n`). O método e os resultados de 2026-11-22 estão em [teste de carga](../../docs/desenvolvimento/teste-de-carga.md):
- 10 mil clientes em 3 processos: todos entraram e nenhum caiu;
- um processo só chega a 1 núcleo com 10 mil;
- com 5 mil, o movimento chegou em p95 de 130 ms.

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

- Redis presence para mais de um processo (doc 05 §4); hoje o matchmaker é local.
- Silenciamentos guardados em banco: hoje ficam na memória do processo.
- Corridas ao vivo; anúncios pagos de jogadores no dirigível (Telecomunicação, fase 2); efeitos de jogo das datas marcadas.
