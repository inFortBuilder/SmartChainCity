# Trilha — Cliente Unity WebGL

Pasta: [`client-unity/`](../../client-unity/README.md) · Especificação: [doc 05 §3](../05-arquitetura-tecnica.md#3-cliente--unity-webgl), [doc 08](../08-metaverso-webgl.md)

## Caminho de desenvolvimento

| Passo | Etapa | O que fazer | Pronto quando |
|------:|-------|-------------|---------------|
| 1 | 0 | **Recuperar o projeto-fonte** do build 0.0.23 (cenas `ShowcaseLogin`, `ShowcaseSelectAvatar`, `SelectWorlds`, `ShowcaseCity`; prefabs `CityBuilder` e `Properties/T1`) | Projeto versionado em `client-unity/` com LFS |
| 2 | 0 | Migrar para **Unity 6 LTS** + URP; remover pós-processamento pesado (AO, TAA) | Abre e roda no editor |
| 3 | 0 | Configurar **Addressables remotos**: grupo `Core` (UI, avatar) + um grupo por célula (`cell_<região>_<cx>_<cy>`) | Catálogo remoto servido do CDN de dev |
| 4 | 0 | **Streaming de células** (raio 1 carregado, raio 2 em LOD, descarregar fora) | 1 região a 60 FPS; download inicial ≤ 25 MB |
| 5 | 1 | Camada de rede `SCC.Net`: cliente REST tipado (gerado do OpenAPI), WebSocket, tratamento de erro e nova tentativa | Login e `GET /v1/me` funcionando |
| 6 | 1 | `SCC.Wallet`: ponte `.jslib` para EIP-1193/WalletConnect; assinatura SIWE | Login com MetaMask na BSC Testnet |
| 7 | 1 | HUD de atributos e tela de turno de trabalho | Turno iniciado e coletado pela UI |
| 8 | 1 | Construção da célula a partir de `GET /v1/world/cells` (lotes, donos, imóveis por `property_type.model`) | Célula reflete o estado do servidor |
| 9 | 2 | Compra de lote (cotação → transação → confirmação), obra com contagem regressiva, interiores aditivos | Fluxo completo na testnet |
| 10 | 2 | Presença multiplayer (Colyseus), interpolação de avatares, chat | 50 avatares por célula a 30+ FPS |
| 11 | 2 | Abertura de Lucky Box com animação e revelação por evento on-chain | Revelação sincronizada com o VRF |
| 12 | 3 | Mobile web: controles de toque, perfil "Low", texturas ASTC | 30 FPS em celular médio |
| 13 | 3 | Fazenda, veículos e corridas, marketplace | Conforme épicos E3.x |
| 14 | 5 | Avatar 3D modular e modo passeio em 3ª pessoa | Onda 5.5 |

## Estrutura do projeto

```
client-unity/
├─ Assets/_SCC/
│  ├─ Boot/          ← carregamento do catálogo remoto e configuração
│  ├─ City/          ← grade, células, streaming, câmera
│  ├─ Avatar/        ← aparência, animação
│  ├─ Properties/    ← prefabs de imóveis (T1, T2, T3, Residenciais...)
│  ├─ UI/            ← HUD, janelas (reaproveitar cv_* do build legado)
│  ├─ Net/           ← REST, WebSocket, DTOs gerados
│  ├─ Wallet/        ← ponte .jslib, SIWE
│  ├─ Minigames/     ← visualização dos turnos
│  └─ Editor/        ← menus de build (SCC > Build > WebGL)
├─ Packages/
├─ ProjectSettings/
└─ WebGLTemplates/SCC/  ← template HTML com loader, barra de progresso e detecção de dispositivo
```

## Configurações de build WebGL

| Opção | Valor |
|-------|-------|
| Compression Format | Brotli (servidor envia `Content-Encoding: br`) |
| Decompression Fallback | Desligado em produção |
| Code Optimization | Disk Size / Shorter build time em dev |
| Managed Stripping Level | High (com `link.xml` para reflexão necessária) |
| Exception Support | Explicitly Thrown Exceptions Only (dev: Full) |
| Initial Memory / Max | 256 MB / 1 GB (desktop) |
| Data Caching | Ligado |
