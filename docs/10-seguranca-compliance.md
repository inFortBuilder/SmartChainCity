# 10 — Segurança, Riscos e Compliance

## 1. Achados no material legado (`C:\SmartChainCity`)

| # | Severidade | Achado | Ação |
|---|-----------|--------|------|
| 1 | **Crítica** | Pasta `chaves/` contém uma chave privada `smartchaincity.pem`, arquivos de acesso e um código de backup do Stripe em texto puro; `Contrato-wireshap/acessos.txt` e `site/Acessos-Backend-SmartChainCity.zip` também parecem guardar acessos. *(Os conteúdos não foram abertos nesta análise.)* | Considerar tudo comprometido: **rotacionar** chaves SSH/AWS, senhas, tokens e o backup code do Stripe; mover para um cofre (AWS Secrets Manager / 1Password); apagar as cópias locais depois da rotação. |
| 2 | **Crítica** | No Strapi, `balance-controller.math` soma ou subtrai saldo de qualquer carteira pelo cabeçalho `wallet_address` e pelo parâmetro `amount`, sem autenticação nem validação de origem. | Remover o endpoint. Saldo só muda por regras do servidor e pelo ledger (doc 06). |
| 3 | Alta | `wallet.deposit` aceita `blockNumber`, `transactionHash` e `amount` enviados pelo cliente. | Depósitos devem ser confirmados **pelo indexer** lendo a blockchain, nunca pelo corpo da requisição. |
| 4 | Alta | Saldos em `float` (`wallet.scity`, `wallet.thaler`) e `user.balance` duplicado. | `NUMERIC` em unidades mínimas; ledger de dupla entrada. |
| 5 | Média | Strapi 4.4.3 e Node ≤ 16 estão fora de suporte. | Migrar para Strapi 5 / Node LTS atual. |
| 6 | Média | Backups do WordPress (`dup-database__*.sql`, `wp-config` arquivado) com dados de usuários e credenciais do banco. | Tratar como dado pessoal (LGPD): armazenar criptografado ou descartar; rotacionar a senha do banco. |
| 7 | Média | Documentos pessoais (CPF, endereços, dados bancários) em contratos na mesma pasta dos ativos do jogo. | Separar o repositório jurídico do técnico, com acesso restrito. |

## 2. Ameaças do jogo e controles

| Ameaça | Controle |
|--------|----------|
| Cliente adulterado (WebGL é inspecionável) | Servidor autoritativo; nenhuma regra de saldo ou sorteio no cliente |
| Multi-contas / bots farmando P2E | Limite de 3 avatares por conta; KYC progressivo para saques acima de um limite; detecção de device fingerprint, IP e padrões de comportamento; captcha no cadastro |
| Replay de requisições | `Idempotency-Key` e nonces; vouchers EIP-712 com `nonce` e `deadline` |
| Roubo de chave do signer | KMS, rotação por timelock, limites diários no `GameVault`, alerta de anomalia |
| Exploit de contrato | Auditoria, fuzzing, pausa por multisig, limites de saída |
| Manipulação de câmbio | TWAP de 24 h, spread, limite diário de conversão |
| Lavagem via marketplace | Monitoramento de wash trading; limites para contas novas; KYC acima de limites |
| Phishing de carteira | Domínio oficial único, assinatura SIWE legível, nunca pedir seed |
| Chat tóxico | Filtro, denúncia, moderação, silenciamento |

## 3. Riscos regulatórios (Brasil) — validar com assessoria jurídica

> Esta seção levanta pontos de atenção; **não é parecer jurídico**.

| Tema | Ponto de atenção |
|------|------------------|
| **Token como valor mobiliário** | A CVM (Parecer de Orientação nº 40/2022) avalia tokens caso a caso; promessa de retorno sobre investimento pode caracterizar contrato de investimento coletivo. O material de marketing deve evitar promessas de rendimento e "payback". |
| **Contratos de investidor existentes** | Há contratos que preveem aporte em reais com devolução em $SCITY em parcelas mensais. Avaliar a natureza jurídica e o passivo antes do TGE. |
| **Marco legal dos criptoativos** (Lei 14.478/2022 e regulamentação do Banco Central) | Se a plataforma custodiar, intermediar ou converter ativos virtuais, pode ser enquadrada como prestadora de serviços de ativos virtuais. O desenho com carteira do usuário e saques por voucher reduz a custódia, mas o tema precisa ser avaliado. |
| **Lucky Boxes / loot boxes** | Mecânica de sorteio paga com item de valor de revenda é tratada como jogo de azar em alguns países e está em debate no Brasil (inclusive para menores). Publicar probabilidades, restringir a maiores de 18 anos e bloquear jurisdições conforme o parecer. |
| **LGPD** | Base legal para dados de conta, KYC e telemetria; política de privacidade; DPO; retenção mínima. |
| **Consumidor (CDC)** | Termos claros sobre a natureza virtual dos imóveis, risco de perda de valor e regras de desastre e depreciação. |
| **Tributação** | Ganhos de capital com criptoativos e obrigações de declaração; orientar os usuários e cumprir as obrigações da empresa. |
| **Propriedade intelectual** | Confirmar a cessão completa da PI (marca, código, arte, estudos FGV Jr.) à empresa operadora antes do lançamento. |
| **Imóveis reais** | Deixar explícito que imóveis virtuais **não** conferem direito sobre imóveis físicos, mesmo em réplicas de cidades reais. |

## 4. Checklist antes da mainnet

- [ ] Todas as credenciais legadas rotacionadas e removidas do disco.
- [ ] Endpoints de saldo do Strapi removidos; Strapi sem acesso público a dados de jogo.
- [ ] Auditoria dos contratos concluída e publicada.
- [ ] Multisig, timelock e LP travado configurados e publicados.
- [ ] Termos de uso, política de privacidade e aviso de risco publicados.
- [ ] Parecer jurídico sobre token, boxes e contratos de investidores.
- [ ] Plano de resposta a incidentes (pausa, comunicação, ressarcimento).
- [ ] Teste de carga: 10 mil usuários simultâneos no Realtime e 1 mil req/s na API.
