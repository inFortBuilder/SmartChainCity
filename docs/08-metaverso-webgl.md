# 08 — Metaverso e WebGL

## 1. Duas portas de entrada

| Porta | Para quê | Tecnologia |
|-------|----------|------------|
| **Jogo SCC (WebGL próprio)** | Gestão da cidade, economia, posse, trabalho, negócios — a experiência completa | Unity 6 → WebGL, hospedado no CDN do projeto |
| **Espaços no metaverso** | Showrooms de imóveis, eventos ao vivo, lançamentos de regiões, ativações de marcas | **Spatial** (template `spatial-virtualcamp` já existe), opcionalmente WebXR próprio no futuro |

Os espaços de metaverso são **vitrines e eventos**; a posse e o saldo continuam no jogo principal. Um link profundo leva do espaço Spatial ao lote correspondente no jogo (`https://play.../city?x=12&y=-4`).

---

## 2. Orçamento de desempenho WebGL

O build atual (0.0.23) tem **~133 MB** de `.data` e **~12 MB** de `.wasm` — pesado demais para o primeiro carregamento.

| Métrica | Meta |
|---------|------|
| Download inicial (loader + wasm + data + catálogo) | **≤ 25 MB** comprimido (Brotli) |
| Tempo até a tela de login | ≤ 10 s em 20 Mbps |
| Tempo até a cidade jogável | ≤ 20 s (célula atual + vizinhas) |
| Célula (Addressables) | ≤ 3 MB por célula; bairro ≤ 20 MB |
| Memória (heap WebGL) | ≤ 1 GB desktop; ≤ 512 MB mobile |
| FPS | 60 desktop médio; 30 mobile médio |
| Draw calls | ≤ 300 em vista isométrica |
| Triângulos visíveis | ≤ 500 mil desktop; ≤ 150 mil mobile |

### 2.1 Técnicas
- **Code stripping** alto, IL2CPP com otimização de tamanho, remoção de módulos não usados (Physics 2D, VR etc.).
- **Brotli** com cabeçalhos corretos no CloudFront (`Content-Encoding: br`; `application/wasm` para `.wasm`), evitando o *fallback* de descompressão em JS.
- **Addressables remotos** por célula; `preload` apenas de UI, avatar e célula de spawn.
- **Texturas**: atlas por bairro, ASTC/ETC2 para mobile e DXT/BC para desktop (builds separados ou *texture variants*).
- **Instancing** (GPU instancing / SRP Batcher) para árvores, postes, carros e lotes repetidos.
- **LOD + impostores** para prédios distantes; *culling* por célula.
- **Iluminação** baked em lightmaps por célula; uma luz direcional em tempo real para ciclo dia/noite simplificado.
- **Áudio** em streaming e mono para efeitos.
- Pós-processamento leve: o catálogo atual inclui AO, TAA e color grading — manter só color grading no WebGL.

### 2.2 Mobile web
- Detectar dispositivo e baixar o perfil de qualidade "Low".
- Controles por toque (pan, pinch-zoom, tap).
- Avisar que iOS Safari tem limite de memória mais restrito; considerar app nativo/PWA na fase 3.

---

## 3. Streaming do mundo

```
Câmera/avatar em (x,y) ─► célula atual (cx,cy)
      │
      ├─► carregar células no raio 1 (3×3 = 9 células)   [Addressables: cell_<região>_<cx>_<cy>]
      ├─► manter em cache o raio 2 em LOD baixo          [impostores]
      ├─► descarregar fora do raio 2
      ├─► GET /v1/world/cells/:cx/:cy  → donos, imóveis, estados (desgaste, obra)
      └─► entrar na sala Realtime da célula              [presença de outros jogadores]
```

Cada imóvel no lote é instanciado a partir de `property_type.model` (já existe no Strapi) → chave Addressable do prefab + variação de nível.

---

## 4. Avatares no metaverso

- **No jogo:** o avatar 2D atual (pele, cabelo, roupas de profissão) serve para UI/cards. Para o modo passeio, um **avatar 3D modular**: corpo base + cabelo + roupa de profissão + acessórios (lojas do GDD §3.23).
- **No Spatial:** o Spatial usa seus próprios avatares; a identidade SCC aparece via vestimentas/acessórios e crachá de profissão/raridade.
- **Interoperabilidade:** exportar o avatar em glTF/VRM no futuro, para outros metaversos (o GDD prevê "outros metaversos do Smart Chain City" e viagens entre eles).

---

## 5. Espaços Spatial (a partir de `spatial-virtualcamp`)

| Espaço | Conteúdo | Fase |
|--------|----------|------|
| **Stand de Vendas** | Maquete interativa da região que será lançada, preços, link para comprar o lote | 1 |
| **Prefeitura Virtual** | Auditório para anúncios, AMAs com a comunidade (lição Plants vs Undead: comunicação constante) | 1 |
| **Showroom de Imóveis** | Modelos T1–T3 e Residenciais em escala 1:1 para visitação | 1 |
| **Arena de Eventos** | Final do campeonato de futebol de botão, corridas, fashion week | 2 |
| **Loja de Marca** | Ativação patrocinada de empresas reais (GDD §3.30) | 2 |

Notas técnicas:
- O projeto Spatial está em **Unity 2021.3.8f1 / URP 12** e deve permanecer separado do cliente principal (o SDK exige a versão de Unity suportada por ele — verificar a versão atual exigida pelo Spatial antes de atualizar).
- Reaproveitar modelos do cliente principal exportando *prefabs* sem scripts proprietários (o Spatial roda scripts próprios/Visual Scripting com restrições).
- Orçamento de tamanho e polígonos conforme limites publicados pelo Spatial.

---

## 6. Vida da cidade (o que faz parecer um metaverso)

- **Ciclo dia/noite** sincronizado ao relógio do servidor (1 dia de jogo = 24 h reais, porque os turnos e as fomes seguem horas reais).
- **Estações** a cada 7 dias com mudança visual (folhagem, neve leve, decoração).
- **NPCs e trânsito** decorativos com instancing (sem simulação de rota no servidor).
- **Dirigível de promoções** 3×/dia (GDD §3.27) — evento global do Realtime.
- **Food trucks** móveis visíveis no mapa em posições sorteadas.
- **Desastres** com efeito visual na célula afetada.
- **Eventos ao vivo** no espaço público (praça da Prefeitura) com contagem regressiva.

---

## 7. Integração com marcas reais

| Formato | Mecânica |
|---------|----------|
| Loja patrocinada | Imóvel comercial com produtos da marca; itens cosméticos colecionáveis |
| Evento patrocinado | Evento semanal de profissão com bônus (ex.: Evento Gastronômico) |
| Outdoor e dirigível | Inventário publicitário por célula e horário |
| Showroom imobiliário | Empreendimento real exibido como imóvel virtual visitável (sem vínculo jurídico) |

Regras: identificação clara de publicidade; nenhum produto real vendido por SCITY sem estrutura legal; respeito a LGPD na captura de leads.
