# Guia de Exportação para SCC Builder

## Como exportar de 3ds Max, Revit, SketchUp e Lumion

Este guia explica passo a passo como exportar seus projetos arquitetônicos para formatos compatíveis com o SCC Builder, garantindo a melhor qualidade e fidelidade de conversão para `.GLB`.

---

## 📦 Formatos Compatíveis por Software

| Software       | Formato Recomendado   | Alternativa     |
| -------------- | --------------------- | --------------- |
| 3ds Max        | `.FBX` (com texturas) | `.OBJ` + `.MTL` |
| Autodesk Revit | `.FBX`                | `.IFC`, `.OBJ`  |
| SketchUp       | `.DAE` (Collada)      | `.OBJ` + `.MTL` |
| Lumion         | `.FBX`                | `.DAE`          |

---

## 🔷 Autodesk 3ds Max → FBX/OBJ

### Exportação via FBX (Recomendado)

1. Abra seu projeto no **3ds Max**
2. Acesse **File → Export → Export** (ou `File → Export → Export Selected` para exportar seleção)
3. Na caixa de diálogo, selecione o tipo: **Autodesk (\*.FBX)**
4. Configure as opções FBX:
   - ✅ **Embed Media** → Incorporar texturas no arquivo
   - ✅ **Smoothing Groups** → Preservar grupos de suavização
   - ✅ **Normals** → Exportar normais de vértice
   - Unidade de Medida: **Centimetros (cm)** ou **Metros (m)**
   - Eixo: **Y-Up** (compatível com motores de jogo) ou **Z-Up** (padrão CAD)

5. Clique em **OK** → Salve o arquivo `.fbx`
6. Importe o `.fbx` no SCC Builder

### Exportação via Plugin GLTF (Direto para GLB)

Instale o plugin oficial da Autodesk:

```
https://apps.autodesk.com/3DSMAX/en/Detail/Index?id=7070939603281413496
```

- File → Export → Exportar como **GLTF 2.0 (.glb)**
- Já exporta em formato game-ready sem conversão adicional!

### Exportação via OBJ

1. **File → Export → Export**
2. Tipo: **OBJ Exporter (\*.OBJ)**
3. Opções:
   - ✅ **Export Materials** → Exportar arquivo `.MTL` junto
   - ✅ **Flip YZ-Axis** → Compatibilidade com sistemas Y-Up
4. Coloque o `.obj` e o `.mtl` na mesma pasta ao importar no SCC Builder

---

## 🔴 Autodesk Revit → FBX/IFC

### Exportação via FBX

1. Abra seu projeto Revit (`.rvt`)
2. Vá em **File → Export → CAD Formats → FBX**
3. Nas configurações:
   - Nível de detalhe: **Fine** ou **Medium** (mais detalhes vs. desempenho)
   - ✅ **Export textures and materials**
   - Coordenadas: manter padrão interno do Revit (será ajustado pelo SCC Builder)
4. Salve o `.fbx` e importe no SCC Builder

> **⚠️ Nota Revit:** Os arquivos FBX do Revit usam eixo **Z-Up** por padrão. No SCC Builder, use a opção **"Convert Z-Up to Y-Up"** para compatibilidade com motores de jogo.

### Exportação via IFC (Arquitetura BIM)

1. **File → Export → IFC**
2. Configurações IFC:
   - Versão: **IFC 2x3** ou **IFC 4** (amplamente suportado)
   - ✅ Incluir camadas de arquitetura, estrutura e MEP conforme necessário
3. Importe o `.ifc` no SCC Builder

---

## 🟢 SketchUp → DAE (Collada) / OBJ

### Exportação via Collada (.dae) — Recomendado

1. Abra seu projeto no **SketchUp**
2. **File → Export → 3D Model...**
3. Tipo de arquivo: **Collada File (\*.dae)**
4. Clique em **Options**:
   - ✅ **Export Texture Maps** → Exportar texturas
   - ✅ **Preserve Component Hierarchies** → Manter hierarquia de grupos
   - Unidades: **Meters** ou a unidade do seu projeto
5. Exporte o arquivo `.dae`

> **Importante:** Ao exportar DAE do SketchUp, as texturas são salvas em uma pasta separada com o mesmo nome do arquivo. Mantenha a pasta e o `.dae` juntos!

### Exportação via OBJ (Alternativa)

1. **File → Export → 3D Model...**
2. Tipo: **OBJ File (\*.obj)**
3. Opções:
   - ✅ **Export Materials** → Exportar `.MTL`
   - ✅ **Swap YZ Coordinates** (para Y-Up)
4. Importe o `.obj` no SCC Builder

---

## 🔵 Lumion → FBX/DAE

> **Nota:** O Lumion é um software de renderização e apresentação. Para exportar o modelo de base arquitetônica, você precisa exportá-lo do software de origem (Revit, ArchiCAD, SketchUp) e importar no Lumion. Para conversão GLB, use o arquivo original exportado do software de origem.

### Exportação do Modelo Base via Lumion (via .SKP/.FBX)

1. No Lumion, acesse **File → Import...**
2. Selecione seu modelo base (geralmente um `.fbx` do Revit ou `.skp` do SketchUp)
3. Para exportar o estado atual no Lumion:
   - **Editor → Export → 3D Model**
   - Formato suportado: **Collada (.dae)** ou **FBX**

### Fluxo Recomendado: Lumion → 3ds Max / Revit → FBX → SCC Builder

```
Revit / SketchUp  ──→  FBX  ──→  Lumion (Visualização)
                   └──→  FBX  ──→  SCC Builder  ──→  .GLB
```

---

## 🔁 Correção de Eixo (Z-Up vs. Y-Up)

| Software        | Eixo Padrão | Ação no SCC Builder                   |
| --------------- | ----------- | ------------------------------------- |
| 3ds Max         | Z-Up        | Selecione "Convert Z-Up to Y-Up"      |
| Revit           | Z-Up        | Selecione "Convert Z-Up to Y-Up"      |
| SketchUp        | Y-Up        | Manter orientação original            |
| Lumion (FBX)    | Z-Up        | Selecione "Convert Z-Up to Y-Up"      |
| Motores de Jogo | Y-Up        | Padrão Three.js, Unity, Unreal Engine |

---

## 💡 Melhores Práticas de Exportação

1. **Texturas**: Sempre incorporate as texturas no arquivo FBX ou mantenha as texturas na mesma pasta do arquivo exportado.
2. **Escala**: Confirme a unidade de medida (metros ou centímetros) durante a exportação. O SCC Builder normaliza automaticamente, mas textos e rótulos dependem da escala correta.
3. **Polígonos**: Para uso em plataformas gamer, simplifique o modelo antes de exportar (use Decimate/ProOptimizer no 3ds Max, ou Reduce no SketchUp).
4. **Nome dos Objetos**: Nomeie seus objetos/grupos no software de origem para facilitar a inspeção na árvore hierárquica do SCC Builder.
5. **Materiais**: Use materiais com nomes descritivos — eles serão preservados na hierarquia do GLB.

---

## 🧩 Ferramentas Auxiliares Recomendadas

| Ferramenta                                                                                                        | Uso                                          |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [Autodesk FBX Converter](https://www.autodesk.com/developer-network/platform-technologies/fbx-converter-archives) | Converter FBX entre versões                  |
| [Blender](https://www.blender.org/)                                                                               | Reparar malhas, UV mapping, bake de texturas |
| [MeshLab](https://www.meshlab.net/)                                                                               | Reparo de malhas, redução de polígonos       |
| [glTF Validator (Khronos)](https://github.khronos.org/glTF-Validator/)                                            | Validar arquivos GLTF/GLB gerados            |
