# Plano de resposta a incidentes (E4.6)

O que fazer quando algo dá errado em produção: quem decide, o que se trava primeiro, como se fala com a comunidade e como se ressarce. Cumpre o item "Plano de resposta a incidentes (pausa, comunicação, ressarcimento)" do [checklist antes da mainnet](../10-seguranca-compliance.md#4-checklist-antes-da-mainnet).

**Regra de ouro: primeiro estancar, depois entender.** Pausar custa minutos de jogo. Hesitar pode custar o cofre.

## 1. Severidade

| Nível | Quando | Exemplos | Resposta |
|---|---|---|---|
| **SEV1** | Dinheiro saindo agora, ou risco claro de sair | Chave do signer vazada; exploit de contrato; saque em massa estranho; ledger com saldo criado do nada | Começa em até **15 min**, a qualquer hora. Trava e pausa primeiro. Comunicação em até 1 h |
| **SEV2** | Jogo parado ou dinheiro preso, mas sem perda | Indexer parado (depósito não credita); economy fora; RPC fora; VRF sem resposta | Começa em até 1 h. Comunicação em até 2 h |
| **SEV3** | Parte do jogo com defeito, sem dinheiro em jogo | Corrida com erro; mapa sem carregar um bairro; chat fora | Próximo dia útil. Nota no canal de status se o jogador perceber |

Na dúvida, trate como o nível mais alto: rebaixar depois é fácil.

## 2. Papéis

Num incidente SEV1 ou SEV2, quem abre o incidente vira **comandante** até passar o papel adiante.

| Papel | Faz | Não faz |
|---|---|---|
| **Comandante** | Decide (travar, pausar, comunicar, encerrar), mantém a linha do tempo e chama quem precisa | Não mexe em código durante o incidente |
| **Técnico** | Investiga, executa o runbook e propõe a correção | Não fala com a comunidade |
| **Comunicação** | Publica e atualiza os avisos ([modelos](comunicacao.md)), responde a comunidade e alinha o texto com o comandante | Não promete prazo nem ressarcimento sem o comandante |
| **Signatários** | Assinam no Safe: pausa (2-de-3) e admin/timelock (3-de-5) | Não assinam lote que não foi conferido por outra pessoa |

### Contatos

Fora do repositório: nomes, telefones e e-mails ficam no cofre de senhas da equipe (pasta "Incidentes"), nunca aqui. Esta tabela só diz **quem procurar**.

| Função | Onde encontrar | Reserva |
|---|---|---|
| Plantão técnico (escala semanal) | Cofre da equipe → Incidentes → Escala | Líder técnico |
| Signatários do Safe de pausa (2-de-3) | Cofre → Incidentes → Signatários | Qualquer 2 dos 3 |
| Signatários do Safe de admin (3-de-5) | Cofre → Incidentes → Signatários | Qualquer 3 dos 5 |
| Jurídico e DPO (LGPD) | Cofre → Incidentes → Jurídico | Diretoria |
| Auditoria dos contratos | Contato do relatório da auditoria | — |
| Hospedagem, RPC e KMS | Painel do provedor e contrato de suporte | — |

## 3. Primeiros 15 minutos (SEV1)

1. **Abrir o incidente** no canal interno `#incidente`: o que se viu, quando e quem é o comandante. A partir daqui, tudo que for feito vai para a linha do tempo, com o horário.
2. **Estancar o dinheiro fora da blockchain** (sem deploy, efeito imediato), com as [travas do economy](runbooks/travas-do-economy.md):
   - `withdrawals`: para de emitir vouchers de saque;
   - `exchange`: para o câmbio THALER ↔ SCITY.
3. **Pausar na blockchain**, se o risco envolve contrato ou voucher: o lote [pausar tudo](runbooks/pausar-contratos.md) no Safe 2-de-3. A pausa segura os vouchers já emitidos, as vendas e o mercado.
4. **Preservar a evidência:**
   - logs com `requestId`;
   - snapshot do banco;
   - transações e endereços envolvidos.

   Não apagar nada, nem "limpar" saldo antes de entender.
5. **Primeiro aviso** em até 1 h ([modelo "investigando"](comunicacao.md#1-investigando)).
6. Seguir o **runbook** do caso (abaixo). Se nenhum servir, o comandante decide e o caso vira runbook novo no pós-incidente.

## 4. Runbooks

| Caso | Runbook |
|---|---|
| Chave do signer (KMS) vazada ou usada fora do backend | [signer-vazado.md](runbooks/signer-vazado.md) |
| Exploit ou bug em contrato | [exploit-contrato.md](runbooks/exploit-contrato.md) |
| Indexer, RPC ou reorganização da cadeia: depósito não credita ou credita errado | [indexer-rpc.md](runbooks/indexer-rpc.md) |
| Fazenda de bots, saque em massa, pool P2E drenando | [fraude-p2e.md](runbooks/fraude-p2e.md) |
| Câmbio manipulado (TWAP, pool da DEX) | [cambio.md](runbooks/cambio.md) |
| Serviço ou banco fora do ar | [servico-fora.md](runbooks/servico-fora.md) |
| Phishing, site ou token falso | [phishing.md](runbooks/phishing.md) |
| Vazamento de dados pessoais (LGPD) | [vazamento-dados.md](runbooks/vazamento-dados.md) |

Ferramentas comuns a vários runbooks:
- [Travas do economy](runbooks/travas-do-economy.md): saque e câmbio, sem deploy.
- [Pausar e despausar os contratos](runbooks/pausar-contratos.md): lote do Safe gerado por `contracts/scripts/safe-lote.mjs`.
- [Trocar o signer](runbooks/signer-vazado.md#3-trocar-a-chave): lote do timelock gerado pelo mesmo script.

## 5. Comunicação

- **Canais:** Discord (`#avisos`), X e o banner do site. No jogo, o mapa já mostra sozinho o aviso de saque ou câmbio suspenso, com o motivo público da trava.
- **Cadência:**
  - SEV1: atualização a cada 2 h, mesmo sem novidade;
  - SEV2: a cada 4 h;
  - encerramento com resumo;
  - relatório público em até 7 dias.
- **O que nunca dizer:**
  - culpados;
  - detalhes que ajudem o atacante enquanto o risco existir;
  - prazos que não dependem de nós;
  - "nenhum fundo foi afetado" antes de conferir o ledger e a cadeia.
- **Modelos prontos:** [comunicacao.md](comunicacao.md).

## 6. Ressarcimento

O ledger de dupla entrada é a fonte da verdade (doc 06). Cada movimento tem dono, chave idempotente e horário, então dá para reconstruir o saldo de cada conta antes do incidente.

1. **Medir:** para cada conta afetada, o saldo esperado sem o incidente menos o saldo real. A medida sai de consultas ao ledger e à cadeia, conferidas por duas pessoas.
2. **Decidir** (comandante + diretoria + jurídico):
   - quem é ressarcido;
   - de onde sai (tesouraria, nunca o pool P2E dos outros jogadores);
   - em que moeda.
3. **Pagar pelo ledger:** um lançamento `incident_refund` por conta, com a chave `incident-refund:<incidente>:<conta>`. Repetir nunca paga duas vezes. Ressarcimento em SCITY na carteira passa pelo Safe da tesouraria.
4. **Publicar:** o total e o critério no relatório, sem expor contas.

Ganho indevido de quem explorou o defeito é estornado pelo ledger, com o registro do motivo. Conta com fraude clara segue o fluxo do antifraude (revisão e bloqueio).

## 7. Encerrar e aprender

- **Encerrar:** o comandante encerra quando:
  - o risco acabou;
  - as travas e a pausa foram retiradas, ou há plano para retirar;
  - a comunidade recebeu o aviso de encerramento.
- **Pós-incidente** em até 5 dias úteis, no [modelo](pos-incidente.md), sem procurar culpados: linha do tempo, causa, o que funcionou, o que faltou e ações com dono e prazo.
- **Melhorias no repositório:** cada ação vira tarefa no ROADMAP ou correção com teste de regressão. Runbook que faltou ou errou é corrigido no mesmo PR.

## 8. Treino

- **Antes da mainnet e a cada trimestre**, simular na testnet (97):
  - um SEV1 completo;
  - a pausa pelo Safe 2-de-3;
  - a trava do economy;
  - a troca do signer pelo timelock;
  - os avisos (em canal de teste).
- Medir o tempo até estancar. A meta é menos de 15 min.
- O ensaio do lote do Safe está descrito em [pausar-contratos.md](runbooks/pausar-contratos.md#ensaio), feito em 2026-11-22 num anvil com chain id 97.
