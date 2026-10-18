# 05 — Arquitetura Técnica

## 1. Princípios

1. **Servidor autoritativo.** O cliente WebGL só exibe e pede ações. Saldo, atributos, sorteios e turnos são calculados no servidor. (O backend atual permite que o cliente some saldo via cabeçalho HTTP — doc 10.)
2. **On-chain só o que precisa ser de posse.** Token SCITY, NFTs (avatar, lote, imóvel, veículo raro) e marketplace. Todo o resto fica off-chain.
3. **Dados, não código.** Profissões, tarefas, alimentos, preços e probabilidades ficam em catálogo editável (Strapi) e versionado.
4. **Streaming do mundo.** A cidade é carregada por célula/bairro via Addressables; o primeiro download deve ser pequeno.
5. **Simulação por eventos agendados**, não por *tick* contínuo: um turno de 6 h vira um job que termina num horário conhecido.

---

## 2. Visão geral

```
                          ┌──────────────────────────────┐
  Navegador (desktop/     │  CDN (CloudFront)             │
  mobile)                 │  build WebGL + Addressables   │
 ┌───────────────────┐    └──────────────┬───────────────┘
 │ Unity WebGL client│◄──────────────────┘
 │  - cena da cidade │      HTTPS REST            WebSocket
 │  - UI / HUD       │──────────────┐      ┌───────────────────┐
 │  - wallet bridge  │              ▼      ▼                   │
 └───────┬───────────┘     ┌────────────────────┐   ┌──────────────────────┐
         │ EIP-1193 /      │  API Gateway / BFF │   │ Realtime (Colyseus)   │
         │ WalletConnect   │  (auth, rate limit)│   │ salas por célula:     │
         ▼                 └─────────┬──────────┘   │ presença, chat, eventos│
 ┌───────────────┐                   │              └──────────┬───────────┘
 │ Carteira       │      ┌───────────┼────────────┬────────────┼─────────────┐
 │ (MetaMask,     │      ▼           ▼            ▼            ▼             ▼
 │  embedded)     │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐
 └──────┬────────┘   │ Auth / │ │ Game Core│ │ Economy  │ │ World /  │ │ Catálogo  │
        │            │ Contas │ │ avatares,│ │ ledger   │ │ Land     │ │ (Strapi 5,│
        │            │ (SIWE) │ │ turnos,  │ │ THALER,  │ │ grade,   │ │ backoffice│
        │            └────────┘ │ negócios │ │ câmbio   │ │ posse    │ │ e CMS)    │
        │                       └────┬─────┘ └────┬─────┘ └────┬─────┘ └───────────┘
        │                            │            │            │
        │                      ┌─────▼────────────▼────────────▼─────┐
        │                      │ PostgreSQL · Redis · Fila (BullMQ)  │
        │                      └─────────────────┬───────────────────┘
        │                                        │
        ▼                                 ┌──────▼───────┐
 ┌────────────────────┐   eventos         │ Chain Indexer│
 │ BNB Smart Chain     │─────────────────►│ + Relayer    │
 │ SCITY, NFTs, Market │◄─────────────────│ (assinatura  │
 └────────────────────┘   mint/claims     │  de vouchers)│
                                          └──────────────┘
```

---

## 3. Cliente — Unity WebGL

| Item | Decisão |
|------|---------|
| Engine | **Unity 6 LTS** (migrar do build atual; o template Spatial está em 2021.3 e deve ficar como projeto separado) |
| Render | URP, perfil WebGL 2; WebGPU como experimento quando estável |
| Câmera | Isométrica/top-down para gestão da cidade + modo 3ª pessoa para passear (metaverso) |
| Mundo | Addressables por **célula** (`cell_A1_4_4`), bairro como grupo de dependências; *Remote catalog* no CDN |
| Avatar | Hoje 2D (sprites de pele, cabelo, roupas de profissão). Para metaverso: avatar 3D modular (corpo + roupas por raridade) com LOD |
| UI | UI Toolkit ou uGUI + TextMeshPro (as janelas `cv_*` do build atual podem ser reaproveitadas) |
| Rede | REST (`UnityWebRequest`) + WebSocket (cliente Colyseus para Unity) |
| Carteira | Ponte JavaScript (`.jslib`) para EIP-1193 (MetaMask) e WalletConnect/Reown; login com assinatura SIWE |
| Localização | Unity Localization; PT-BR padrão, EN e ES na sequência |
| Telemetria | Eventos para o backend (sessão, funil, economia) |

Orçamentos de desempenho: [08 — Metaverso e WebGL](08-metaverso-webgl.md).

### 3.1 Cenas

| Cena | Função | Existe no build 0.0.23? |
|------|--------|:-----------------------:|
| `Boot` | Carrega catálogo remoto e configuração | — |
| `Login` | E-mail/social + carteira | `ShowcaseLogin` |
| `SelectAvatar` | Escolher/abrir Lucky Box | `ShowcaseSelectAvatar` |
| `SelectWorld` | Escolher cidade/servidor | `SelectWorlds` |
| `City` | Cidade com streaming de células | `ShowcaseCity` |
| `Interior_*` | Interiores (casa, loja, hospital) carregados aditivamente | — |
| `Minigame_*` | Visualização do turno de trabalho | — |

---

## 4. Backend

| Serviço | Responsabilidade | Stack sugerida |
|---------|------------------|----------------|
| **API Gateway / BFF** | Autenticação JWT, rate limit, agregação para o cliente | NestJS ou Fastify (TypeScript) |
| **Auth / Contas** | Cadastro, login social/e-mail, vínculo de carteira (SIWE — EIP-4361), sessões, 2FA, limite de 3 avatares | Mesmo serviço; Postgres |
| **Game Core** | Avatares, atributos, turnos de trabalho, minigames, saúde/doenças, pets, fazenda, negócios | TypeScript; jobs na fila |
| **Economy / Ledger** | Ledger de dupla entrada para THALER, impostos, câmbio, conversão, limites de saque | TypeScript; transações SERIALIZABLE |
| **World / Land** | Grade, zoneamento, posse (espelho do on-chain), PT, regras de bairro e cerco | TypeScript + PostGIS opcional |
| **Marketplace off-chain** | Listagens, ordens, *matching* de itens não-NFT | TypeScript |
| **Realtime** | Presença por célula, chat, eventos ao vivo, corridas | **Colyseus** (Node) — salas por célula |
| **Chain Indexer / Relayer** | Lê eventos dos contratos, confirma depósitos, assina *vouchers* de mint/saque | TypeScript + ethers/viem; chave em KMS |
| **Catálogo / Backoffice** | Edição de profissões, tarefas, preços, eventos, textos; upload de arte | **Strapi 5** (evolução do Strapi 4.4.3 atual) |
| **Scheduler** | Estações (7 dias), impostos, decaimento de atributos, eventos semanais | BullMQ + Redis |

### 4.1 Por que manter o Strapi só como backoffice
O Strapi atual já tem os modelos de catálogo, i18n, upload S3 e e-mail. Ele é ótimo para conteúdo, mas não para regras transacionais (concorrência, ledger, antifraude). Assim:
- **Strapi**: `job`, `job_task`, `food`, `activity`, `rarity`, `property_type`, `property_level`, eventos, textos.
- **Game Core/Economy**: tudo que tem saldo, posse ou tempo.
- O Game Core lê o catálogo publicado pelo Strapi (webhook → cache Redis).

### 4.2 Simulação do turno de trabalho

```
POST /avatars/:id/work {shift: "6h"}
  ├─ valida energia, emprego, moradia, transporte
  ├─ calcula início = agora + atraso_deslocamento
  ├─ sorteia eventos de dano/bônus com seed = H(avatarId, turnoId, segredo_servidor)
  ├─ persiste work_shift {inicio, fim, seed, resultado_previsto (oculto)}
  └─ agenda job "shift.complete" para o horário `fim`
job shift.complete
  ├─ aplica deltas de energia/felicidade/saúde
  ├─ credita THALER no ledger (status = claimable)
  └─ notifica o cliente (WebSocket / push)
POST /avatars/:id/claim  → move de claimable para disponível
```

O seed com segredo do servidor, revelado depois (commit-reveal), permite auditoria pública dos sorteios sem permitir previsão.

### 4.3 Multiplayer
- O jogo é majoritariamente **assíncrono**; o multiplayer serve para presença, social e eventos.
- **Sala Colyseus por célula** (36 lotes); ao andar, o cliente entra na sala vizinha (interest management simples). Capacidade alvo: 50–100 avatares por sala.
- Corridas e campeonatos: salas dedicadas, servidor calcula o resultado.
- Escala: Colyseus em contêineres (ECS Fargate/Kubernetes) com Redis presence. O **AWS GameLift** (há um guia na pasta legada) só vale se surgirem modos de ação em tempo real com física — não é necessário no MVP. O cliente WebGL não abre sockets UDP, então qualquer servidor precisa de WebSocket/WebRTC.

### 4.4 Ponte on-chain ↔ off-chain

| Fluxo | Como funciona |
|-------|---------------|
| **Depósito SCITY → THALER** | Jogador chama `deposit(amount)` no contrato `GameVault`; o indexer espera N confirmações (proposto: 15 blocos) e credita THALER pelo câmbio vigente. Idempotência pela `tx_hash` (o Strapi já tem `transaction_blockchain`). |
| **Saque THALER → SCITY** | Servidor debita THALER, aplica spread e limites, assina um **voucher EIP-712** `{to, amount, nonce, deadline}`; o jogador resgata no `GameVault.claim(voucher, sig)`. |
| **Compra de NFT primário** (box, lote) | Pagamento direto no contrato; o indexer espelha a posse. |
| **Mint de imóvel/ativo ganho no jogo** | Voucher assinado → jogador faz o mint (paga o gas) ou relayer faz *lazy mint* sob demanda. |

### 4.5 Blockchain
- **Rede:** BNB Smart Chain (alinhada ao nome do projeto e aos parceiros do site legado). Testnet BSC para homologação.
- **Padrões:** BEP-20 (SCITY), ERC-721 (avatar, lote, imóvel), ERC-1155 (itens empilháveis colecionáveis, opcional), EIP-712 (vouchers), EIP-2981 (royalties).
- **Aleatoriedade das Lucky Boxes:** Chainlink VRF ou commit-reveal on-chain.
- **Onboarding:** carteira embutida/abstração de conta (ERC-4337) para quem entra por e-mail; carteira externa opcional.
- Detalhes: [07 — Smart Contracts](07-smart-contracts.md).

---

## 5. Infraestrutura (AWS)

| Componente | Serviço |
|------------|---------|
| Build WebGL e Addressables | S3 + CloudFront com `Content-Encoding: br` e `Content-Type` corretos para `.wasm` e `.data` |
| APIs e Realtime | ECS Fargate (ou EKS) atrás de ALB com suporte a WebSocket |
| Banco | RDS PostgreSQL (Multi-AZ); o Strapi pode continuar em MySQL ou migrar para Postgres |
| Cache/fila | ElastiCache Redis |
| Segredos | AWS Secrets Manager; chave do relayer em **AWS KMS** (nunca em `.pem` no disco) |
| Uploads do CMS | S3 (já configurado no Strapi) |
| E-mail | SendGrid (já configurado) ou SES |
| Observabilidade | CloudWatch + OpenTelemetry; Sentry no cliente e no servidor |
| CI/CD | O CI atual é GitLab → Docker → SSH. Evoluir para pipeline com testes, build WebGL em runner com Unity, deploy por ambiente (dev, staging, prod) |
| Ambientes | `dev` (testnet), `staging` (testnet, dados de carga), `prod` (mainnet) |

---

## 6. Repositório (monorepo proposto)

```
SmartChainCity/
├─ docs/                      ← esta documentação
├─ client-unity/              ← projeto Unity 6 (WebGL)
│   └─ Assets/_SCC/{City,Avatar,UI,Net,Wallet,Minigames,Addressables}
├─ metaverse-spatial/         ← espaços Spatial (a partir de spatial-virtualcamp)
├─ services/
│   ├─ gateway/
│   ├─ game-core/
│   ├─ economy/
│   ├─ world/
│   ├─ realtime/              ← Colyseus
│   └─ chain-indexer/
├─ cms-strapi/                ← Strapi 5 (migrado de Strapi-main)
├─ contracts/                 ← Hardhat/Foundry
├─ tools/
│   ├─ osm-to-grid/           ← pipeline de réplica de cidade (doc 03 §7)
│   └─ econ-sim/              ← simulador econômico
└─ infra/                     ← IaC (Terraform/CDK)
```
