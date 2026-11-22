# Teste de carga (E3.9)

Critério do [doc 10](../10-seguranca-compliance.md): **10 mil usuários simultâneos no Realtime e 1 mil req/s na API**. O alvo de latência vem do [guia de testes](testes-qualidade.md): p95 abaixo de 200 ms nas rotas de leitura.

As duas ferramentas rodam na máquina local, sem serviço pago. Os números abaixo são de **uma máquina só**: servidores e gerador de carga dividem a mesma CPU. Um teste em infraestrutura separada (staging) fica para quando houver o ambiente.

## Como rodar

**API.** Sobe os serviços e roda o gerador com o `JWT_SECRET` deles, para assinar tokens de contas sintéticas:

```bash
LOAD_JWT_SECRET=<JWT_SECRET dos serviços> node tools/load-test/api.mjs --rate 1000 --seconds 30
```

- É carga aberta: os pedidos saem no ritmo pedido, respondidos ou não. Por isso um servidor lento não diminui a carga, e a fila aparece na latência.
- Mistura de leituras, como o painel do mapa faz:
  - avatares, saldo, lote, catálogo de comida, evento da semana, fazenda e câmbio;
  - o `healthz` do gateway.
- `--only game` isola um serviço, para achar gargalo.
- `--json arquivo` grava o resumo.
- Passa com: o ritmo pedido (≥ 95%), p95 abaixo de 200 ms e menos de 1% de erros.

**Realtime.** Pode subir o servidor no próprio processo:

```bash
pnpm --filter @scc/realtime load:city
```

Ou rodar contra processos no ar, cada um com o mesmo `JWT_SECRET`:

```bash
JWT_SECRET=<o mesmo> pnpm --filter @scc/realtime load:city -- \
  --urls http://127.0.0.1:8150,http://127.0.0.1:8151,http://127.0.0.1:8152 \
  --clients 10000 --workers 5 --ramp 200 --hold 30 --rate 2
```

- Os clientes entram em rampa e se dividem em bairros de 100 (o `maxClients` da sala).
- Cada um anda 2 vezes por segundo. O cliente do mapa manda até 5 por segundo quando se move, e só quando algo muda; parado, nada.
- Um observador por bairro mede quanto um movimento leva para chegar.
- Os clientes rodam em threads separadas. Com `--urls`, o bairro `d` vai para o processo `d % n`.
- Passa com: 99% entraram, ninguém caiu e o movimento chegou em menos de 500 ms (p95).

## Resultados em 2026-11-22

Máquina: AMD Ryzen 5 3400G (4 núcleos, 8 threads), 32 GB, Windows 11, Node 24. A pilha de teste é o gateway, o economy, o game-core e o world com segredos de teste, e o world e o game-core no Postgres local (`scc_test`).

### API: passou

| Ritmo | Atingido | Erros | p50 | p95 | p99 |
|------:|---------:|------:|----:|----:|----:|
| 1.000 req/s, 30 s | 1.000 | 0 | 5,4 ms | 15,3 ms | 294 ms |
| 1.500 req/s, 30 s | 1.500 | 0 | 6,1 ms | 20,5 ms | 61 ms |

- O p95 por rota ficou abaixo de 23 ms.
- **A primeira rodada com os serviços recém-subidos teve p95 de 146 ms**, com 400 ms nas rotas do game-core, por causa do aquecimento: o tsx compila na primeira chamada.
- Isolado a 600 req/s, o game-core ficou em p95 de 13 ms, e o Postgres ficou praticamente parado durante a carga.

### Realtime: as 10 mil conexões passaram; a latência a 10 mil não dá para medir numa máquina só

| Rodada | Entraram | Caíram | Entrada p95 | Movimento p50 / p95 / p99 | Resultado |
|--------|---------:|-------:|------------:|--------------------------:|-----------|
| 10 mil, 1 processo, fetch padrão | 4.472 | 0 | 5,4 s | 124 / 379 / 542 ms | Falhou: portas |
| 10 mil, 1 processo, fetch com keep-alive | 9.255 | 0 | 19,9 s | 222 / 498 / 581 ms | Falhou: 1 núcleo cheio |
| 10 mil, 3 processos (por bairro) | **10.000** | **0** | 4,5 s | 114 / 871 / 1.314 ms | Latência acima do alvo, com a máquina a 100% |
| 5 mil, 3 processos (por bairro) | **5.000** | **0** | 2,1 s | **59 / 130 / 240 ms** | **Passou** |

O que cada rodada mostrou:

1. **Portas do Windows.** O matchmaking do Colyseus é HTTP. Com o `fetch` padrão, cada entrada abriu uma conexão nova. 10 mil entradas e 10 mil WebSockets passam das 16.384 portas dinâmicas do Windows, e o matchmaking falhou com `fetch failed` (7.159 conexões ainda em TIME_WAIT depois). O teste passou a usar um `fetch` com poucas conexões reaproveitadas, sem mudar a configuração do sistema. **Em produção isso não acontece**, porque cada jogador está numa máquina, mas vale para qualquer teste num computador só.
2. **Um processo do realtime chega a 1 núcleo.** Com 10 mil clientes e 20 mil movimentos por segundo, o processo único usou o núcleo inteiro (o Colyseus roda numa thread por processo). O matchmaking enfileirou (entrada p95 de 20 s) e 745 entradas venceram o prazo.
3. **Dividir por bairro escala.** As salas já se separam por cidade e bairro (`filterBy`), então 3 processos com os bairros divididos receberam os 10 mil, com 0 queda. Os 3 juntos usaram cerca de 2,4 núcleos e 775 MB no pico.
4. **A latência a 10 mil saiu contaminada pelo gerador.** Durante a carga cheia, a máquina ficou a 99–100% de CPU. Os servidores usavam 2,4 núcleos, e o resto era o gerador recebendo os estados de 10 mil clientes. Com metade (5 mil), longe da saturação, o atraso p95 foi de 130 ms.

**Conclusão:** o realtime aguenta 10 mil conexões com a divisão por bairro entre processos. Para confirmar a latência a 10 mil, o gerador precisa de outra máquina.

## Divisão por bairro no cliente (2026-11-22)

O mapa e o interior escolhem o processo pela chave da sala: FNV-1a de `cidade:bairro` (ou `cidade:lote:N`), módulo o número de processos em `?realtime=a,b,c`. Cada processo sobe com `SHARD=i/n` e recusa o que não é dele (`421 wrong_shard`), então uma lista errada no cliente não parte um bairro em dois. O `load:city` usa a mesma regra.

Conferido no navegador com 2 processos (`SHARD=0/2` e `1/2`):
- o mapa entrou no bairro 1 pelo processo 8151, e o 8150 ficou sem salas;
- entrar no mesmo bairro pelo 8150 foi recusado com `421 wrong_shard`.

Com a carga, já aquecidos, 2.000 clientes nos 2 processos com `SHARD` entraram todos (0 queda, movimento p95 de 120 ms). A primeira rodada, com os processos frios, perdeu 269 entradas.

## O que falta para fechar o E3.9

- **Rodada com o gerador em outra máquina,** para medir a latência a 10 mil sem a CPU dividida.
- **Rodada noturna em staging** (testes-qualidade), quando houver o ambiente.
