# Checklist de lançamento

O que falta para a mainnet e para a venda da A1, na ordem em que um passo destrava o outro. O código para cada passo já está no repositório (2026-11-22). O que resta depende de pessoas de fora: jurídico, auditoria, signatários, provedores e arte.

Cada item diz **quem** (papel, não nome; contatos no cofre da equipe, como no [plano de incidentes](incidentes/README.md#contatos)), **o que já está pronto** e **como conferir**. Marque o item no PR que registrar a conclusão.

## Fase 0: antes de tudo

- [ ] **Credenciais legadas trocadas** (E0.2, [doc 10 §1](10-seguranca-compliance.md#1-achados-no-material-legado-csmartchaincity)): chaves SSH/`.pem`, AWS, banco, SendGrid, Stripe e os acessos do material antigo.
  - **Quem:** líder técnico.
  - **Conferir:** nada do material legado autentica mais; os segredos novos só existem no cofre de segredos.
- [ ] **Parecer jurídico** (E0.8, [doc 10 §3](10-seguranca-compliance.md#3-riscos-regulatórios-brasil--validar-com-assessoria-jurídica)): token, Lucky Box (sorteio pago), contratos de investidores, LGPD, CDC, jurisdições bloqueadas e maioridade.
  - **Quem:** jurídico.
  - **Destrava:** a venda privada, os termos e a privacidade do site e o formato do TGE.
  - **Conferir:** parecer arquivado (fora do repositório) e decisões registradas numa ADR.
- [ ] **Decisões pendentes** (E0.4, [doc 11](11-decisoes-pendentes.md)) fechadas, principalmente as premissas que o jogo usa hoje:
  - queda de alimentação do pet;
  - preços do Pet Shop, do Pet Sitter e dos alimentos;
  - efeitos dos itens da temporada;
  - fator do evento semanal.
  - **Quem:** game designer, com o simulador (`tools/econ-sim`).
  - **Pronto:** os valores ficam no Strapi (eventos, temporadas e catálogo) ou nas constantes marcadas como premissa no código, com o motivo.

## Fase 1: contratos prontos para a mainnet

- [ ] **Auditoria externa** (E3.8).
  - **Quem:** auditoria contratada.
  - **Pronto:** o [pacote do auditor](auditoria/README.md), que tem:
    - escopo com nSLOC, incluindo o TGE (`TgeDistributor`, `RewardsPool`, `TokenLock`);
    - invariantes, cobertura ≥ 95% e Slither no CI.
  - **Passos:**
    1. congelar o commit (tag `auditoria-v1`);
    2. enviar o pacote;
    3. corrigir os achados, cada um com teste de regressão;
    4. pedir nova revisão do que mudou;
    5. publicar o relatório (`SCC_AUDIT_URL` no site).
- [ ] **Safes criados na BSC** (E4.1 e E4.2).
  - **Quem:** diretoria e signatários.
  - **Quais:**
    - admin 3-de-5, que propõe e executa no timelock;
    - pausa 2-de-3;
    - um Safe por alocação do TGE: P2E, staking, DEV, Team, Marketing, liquidez, ICO, Advisors, Ação Social, AirDrop e STAFF. Ou um por grupo, se o jurídico aceitar.
  - **Conferir:** endereços com código na BSC, donos e limiar conferidos por duas pessoas.
- [ ] **Signer no KMS** (E4.1): a chave do backend que assina vouchers (saque, lote, imóvel, prédio, apreensão).
  - **Quem:** infra.
  - **Conferir:**
    - a política deixa só o serviço assinar;
    - o endereço vai em `signer` na config do deploy;
    - o runbook de troca está pronto ([signer vazado](incidentes/runbooks/signer-vazado.md)).
- [ ] **Assinatura do Chainlink VRF v2.5** na BSC, com saldo (E2.1).
  - **Quem:** infra.
  - **Conferir:** `coordinator`, `keyHash` e `subId` na config do deploy. Depois do deploy, adicionar a `LuckyBox` como consumidora.

## Fase 2: ensaio completo na testnet (BSC 97)

Tudo o que vai acontecer na mainnet, com os Safes e a chave de verdade, em rede de teste.

- [ ] **TGE:** `DeployTGE.s.sol` com os Safes de teste ([contracts](../contracts/README.md#tge-vesting-e-lp-travado-e42)).
- [ ] **Contratos:** `DeployMainnet.s.sol` com `scity` = o token do TGE.
  - O próprio script confere os papéis finais e reverte se o deployer ficar com algum.
- [ ] **Serviços em staging** apontando para a testnet:
  - endereços nos `.env` dos serviços;
  - `SIWE_DOMAINS`, `CORS_ORIGINS`, `SIWE_CHAIN_IDS=97`;
  - `GAME_CORE_URL` e `WORLD_URL` no gateway, para os números do site.
- [ ] **Site em staging:**
  - `SCC_GAME_API_URL` (ou `SCC_GATEWAY_URL`, `SCC_GAME_URL`, `SCC_ECONOMY_API_URL`);
  - `SCC_INDEXER_URL`;
  - `SCC_CHAIN_ID=97`;
  - `SCC_DEPLOYMENTS_DIR`.
  - **Conferir:** home com números reais, `/contratos` com os endereços, login, depósito, marketplace (comprar, vender, leiloar).
- [ ] **Treino de incidente** ([plano §8](incidentes/README.md#8-treino)):
  - pausar tudo pelo Safe 2-de-3;
  - trava do economy;
  - troca do signer pelo timelock;
  - avisos em canal de teste.
  - **Meta:** estancar em menos de 15 min.
- [ ] **Teste de carga com o gerador em outra máquina** (E3.9, [teste de carga](desenvolvimento/teste-de-carga.md)): 10 mil no Realtime em processos por bairro e 1 mil req/s na API, medindo a latência sem o gerador disputando CPU.

## Fase 3: dia do TGE (BSC 56)

Na ordem, com o comandante do [plano de incidentes](incidentes/README.md#2-papéis) de plantão.

- [ ] Rodar `DeployTGE` com `CONFIRM_MAINNET=sim` e a carteira de hardware (`--ledger`). Conferir `deployments/56-tge.json`.
- [ ] Rodar `DeployMainnet` com `scity` = o token do TGE e `timelockDelaySeconds` ≥ 172800. Conferir `deployments/56.json`.
- [ ] **Verificar no BscScan** (`--verify`) todos os contratos, incluindo cada `VestingWallet`.
- [ ] **Liquidez:**
  1. o Safe da liquidez cria o par SCITY na PancakeSwap e recebe o LP;
  2. rodar o `lockLiquidity()` (≥ 365 dias);
  3. o Safe transfere **todo** o LP para o `TokenLock`.
  - **Conferir:** `releaseTime` e o saldo do lock na cadeia.
- [ ] **Configurar o jogo:**
  - adicionar a `LuckyBox` na assinatura do VRF;
  - depositar a reserva do `GameVault` (Safe do P2E, a partir do `RewardsPool`);
  - endereços nos serviços de produção.
- [ ] **Publicar os endereços:** commitar `deployments/56*.json`. O site mostra em `/contratos` e no FAQ, e o Discord fixa a mensagem.
- [ ] **Lotes do Safe prontos para incidente:** gerar `pausar.json` e `despausar.json` (`contracts/scripts/safe-lote.mjs`) e guardar no cofre.

## Fase 4: abertura do jogo e venda da A1

- [ ] **Site no ar** (E4.5):
  - domínio;
  - links reais (`SCC_DISCORD_URL` e as redes);
  - trailer;
  - termos de uso, privacidade e aviso de risco (do parecer).
  - **Conferir:** 1440 px e 375 px, `php -l` limpo, a página de contratos com os endereços da mainnet.
- [ ] **Lançamento da A1** (E4.3): agendar a venda com fila e limite por carteira ([world](../services/world/README.md#venda-de-lançamento-fila-e-limite-por-carteira-e43)), na janela anunciada.
  - **Padrões:** fila 30 min antes, 200 entradas por minuto, 3 lotes por carteira e carteira ligada obrigatória.
  - **Conferir:** `GET /v1/world/cities/:code/sale` com a fase e os horários certos.
- [ ] **Monitoramento:**
  - alertas de [observabilidade](../infra/observability/alertas.yml) ligados ao canal de plantão: serviço fora, 5xx, latência, pool P2E, dreno e travas de incidente;
  - contatos reais no cofre (E4.6).
- [ ] **Bug bounty** aberto depois do lançamento ([doc 07 §5](07-smart-contracts.md#5-qualidade-e-segurança)).

## Depois do lançamento

- [ ] Arte final: avatares, pets e imóveis (E3.1 e outros).
- [ ] Eventos de data marcada (Natal, Carnaval) e a loja de itens (E3.10).
- [ ] Espaços Spatial: stand de vendas, Prefeitura Virtual e showroom (E4.4).
- [ ] `StakingPool` (doc 07), com rodada própria de auditoria; até lá, o staking fica no Safe com vesting de 60 meses.
- [ ] Revisão das premissas com os números reais do painel econômico, um mês depois do lançamento.
