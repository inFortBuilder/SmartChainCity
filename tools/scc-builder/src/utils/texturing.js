import * as THREE from 'three';
import { t } from '../i18n/index.js';

/**
 * Texturização de modelos arquitetônicos.
 *
 * Contexto: plataformas como o Hi3D geram textura com difusão em GPU — o
 * modelo entra, um prompt/imagem de referência guia a geração multi-vista,
 * e o resultado é projetado de volta nas UVs. Isso exige infraestrutura de
 * GPU e não roda em WAMP local.
 *
 * O que dá para fazer no browser, e que resolve o problema mais comum na
 * prática, é o outro lado: aplicar texturas em modelos que chegaram SEM
 * elas — porque o `.dae` veio sem a pasta de imagens, ou porque o
 * exportador não gravou UVs.
 *
 * Dois recursos carregam esse peso:
 *
 * 1. PROJEÇÃO TRIPLANAR — dispensa UV por completo. A textura é amostrada
 *    nos três planos do mundo e misturada pela normal da superfície. É o
 *    único caminho quando o modelo não tem `uv`, situação corriqueira em
 *    exportações de Revit e SketchUp.
 *
 * 2. GERAÇÃO DE UV — quando se quer UV de verdade (para exportar com
 *    textura embutida), projeções planar, cúbica, cilíndrica e esférica.
 */

// ── Diagnóstico ──────────────────────────────────────────────────────────

/**
 * O objeto tem coordenadas UV utilizáveis?
 *
 * @param {THREE.Object3D} root
 * @returns {{total: number, comUV: number, semUV: number, cobertura: number}}
 */
export function analyzeUVs(root) {
  let total = 0;
  let comUV = 0;

  root?.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    total++;
    if (child.geometry.getAttribute('uv')) comUV++;
  });

  return {
    total,
    comUV,
    semUV: total - comUV,
    cobertura: total > 0 ? comUV / total : 0,
  };
}

// ── Geração de UV ────────────────────────────────────────────────────────

export const UV_MODES = ['planar', 'box', 'cylindrical', 'spherical'];

/**
 * Gera coordenadas UV para uma geometria, no lugar.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {'planar'|'box'|'cylindrical'|'spherical'} mode
 * @param {number} escala repetições por unidade do modelo
 * @returns {boolean} true se gerou
 */
export function generateUVs(geometry, mode = 'box', escala = 1) {
  const position = geometry.getAttribute('position');
  if (!position) return false;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = new THREE.Vector3();
  box.getSize(size);

  // Evita divisão por zero em geometrias planas.
  const seguro = (valor) => (Math.abs(valor) < 1e-6 ? 1 : valor);

  const normal = geometry.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);

  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);

    let u = 0;
    let v = 0;

    switch (mode) {
      case 'planar':
        // Projeção de cima (planta baixa): X/Z viram U/V.
        u = (p.x - box.min.x) / seguro(size.x);
        v = (p.z - box.min.z) / seguro(size.z);
        break;

      case 'box': {
        // Cada face usa o par de eixos mais alinhado à sua normal — é o
        // que evita o esticamento das laterais na projeção planar.
        if (normal) {
          n.fromBufferAttribute(normal, i);
        } else {
          n.set(0, 1, 0);
        }

        const ax = Math.abs(n.x);
        const ay = Math.abs(n.y);
        const az = Math.abs(n.z);

        if (ax >= ay && ax >= az) {
          u = (p.z - box.min.z) / seguro(size.z);
          v = (p.y - box.min.y) / seguro(size.y);
        } else if (ay >= ax && ay >= az) {
          u = (p.x - box.min.x) / seguro(size.x);
          v = (p.z - box.min.z) / seguro(size.z);
        } else {
          u = (p.x - box.min.x) / seguro(size.x);
          v = (p.y - box.min.y) / seguro(size.y);
        }
        break;
      }

      case 'cylindrical': {
        const centroX = (box.min.x + box.max.x) / 2;
        const centroZ = (box.min.z + box.max.z) / 2;

        u = (Math.atan2(p.z - centroZ, p.x - centroX) + Math.PI) / (2 * Math.PI);
        v = (p.y - box.min.y) / seguro(size.y);
        break;
      }

      case 'spherical': {
        const centro = new THREE.Vector3();
        box.getCenter(centro);

        const d = p.clone().sub(centro).normalize();

        u = (Math.atan2(d.z, d.x) + Math.PI) / (2 * Math.PI);
        v = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI;
        break;
      }

      default:
        return false;
    }

    uv[i * 2] = u * escala;
    uv[i * 2 + 1] = v * escala;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.attributes.uv.needsUpdate = true;

  return true;
}

/**
 * Gera UVs para todas as malhas de um objeto.
 *
 * A escala é derivada do tamanho REAL de cada malha em metros, não do seu
 * bounding box normalizado — sem isso, uma parede de 10 m e um pilar de
 * 0,3 m receberiam a mesma quantidade de repetições e a textura ficaria
 * com escalas visivelmente diferentes entre as peças.
 *
 * @param {THREE.Object3D} root
 * @param {'planar'|'box'|'cylindrical'|'spherical'} mode
 * @param {number} metrosPorRepeticao tamanho do ladrilho em metros
 * @returns {number} malhas processadas
 */
export function generateUVsForObject(root, mode = 'box', metrosPorRepeticao = 1) {
  let processadas = 0;

  root?.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    child.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    child.geometry.boundingBox.getSize(size);

    const maior = Math.max(size.x, size.y, size.z) || 1;
    const escala = Math.max(0.01, maior / Math.max(0.01, metrosPorRepeticao));

    if (generateUVs(child.geometry, mode, escala)) processadas++;
  });

  return processadas;
}

// ── Carregamento de imagem ───────────────────────────────────────────────

/**
 * Converte um File de imagem em textura pronta para uso.
 *
 * @param {File|Blob} file
 * @param {{colorSpace?: string, repeat?: number}} [options]
 * @returns {Promise<THREE.Texture>}
 */
export async function textureFromFile(file, options = {}) {
  const bitmap = await createImageBitmap(file);

  const textura = new THREE.CanvasTexture(bitmap);
  textura.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace;
  textura.wrapS = THREE.RepeatWrapping;
  textura.wrapT = THREE.RepeatWrapping;
  textura.anisotropy = 8;
  textura.name = file.name ?? 'textura';

  const repeat = options.repeat ?? 1;
  textura.repeat.set(repeat, repeat);
  textura.needsUpdate = true;

  return textura;
}

// ── Projeção triplanar ───────────────────────────────────────────────────

/**
 * Aplica projeção triplanar a um material.
 *
 * Injeta GLSL no shader do MeshStandardMaterial: a textura é amostrada nas
 * três projeções do espaço de mundo (XY, YZ, XZ) e as três amostras são
 * misturadas com peso na normal elevada a `sharpness`. O resultado cobre a
 * malha inteira sem nenhuma coordenada UV — e sem costuras visíveis.
 *
 * Custo: três amostragens por fragmento em vez de uma. Em cena
 * arquitetônica isso é irrelevante perto do custo de sombra.
 *
 * @param {THREE.Material} material
 * @param {THREE.Texture} textura
 * @param {{escala?: number, sharpness?: number}} [options]
 */
export function applyTriplanar(material, textura, options = {}) {
  const escala = options.escala ?? 1;
  const sharpness = options.sharpness ?? 4;

  material.userData.__triplanar = { textura, escala, sharpness };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTriplanarMap = { value: textura };
    shader.uniforms.uTriplanarScale = { value: escala };
    shader.uniforms.uTriplanarSharpness = { value: sharpness };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vTriplanarPos;
         varying vec3 vTriplanarNormal;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 triplanarWorld = modelMatrix * vec4( transformed, 1.0 );
         vTriplanarPos = triplanarWorld.xyz;
         vTriplanarNormal = normalize( mat3( modelMatrix ) * objectNormal );`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uTriplanarMap;
         uniform float uTriplanarScale;
         uniform float uTriplanarSharpness;
         varying vec3 vTriplanarPos;
         varying vec3 vTriplanarNormal;

         vec4 amostraTriplanar() {
           vec3 n = normalize( vTriplanarNormal );
           // Pesos: quanto mais a face aponta para um eixo, mais aquela
           // projeção domina. O expoente controla a dureza da transição.
           vec3 peso = pow( abs( n ), vec3( uTriplanarSharpness ) );
           peso /= max( peso.x + peso.y + peso.z, 0.0001 );

           vec3 p = vTriplanarPos * uTriplanarScale;

           vec4 corX = texture2D( uTriplanarMap, p.zy );
           vec4 corY = texture2D( uTriplanarMap, p.xz );
           vec4 corZ = texture2D( uTriplanarMap, p.xy );

           return corX * peso.x + corY * peso.y + corZ * peso.z;
         }`
      )
      .replace(
        '#include <map_fragment>',
        `vec4 triplanarColor = amostraTriplanar();
         triplanarColor = sRGBTransferEOTF( triplanarColor );
         diffuseColor *= triplanarColor;`
      );

    material.userData.__shader = shader;
  };

  // Força a recompilação do programa.
  material.customProgramCacheKey = () => `triplanar-${escala}-${sharpness}`;
  material.needsUpdate = true;

  return material;
}

/** Remove a projeção triplanar de um material. */
export function removeTriplanar(material) {
  if (!material.userData.__triplanar) return false;

  delete material.userData.__triplanar;
  delete material.userData.__shader;

  material.onBeforeCompile = () => {};
  material.customProgramCacheKey = () => 'padrao';
  material.needsUpdate = true;

  return true;
}

/** Atualiza a escala da projeção sem recompilar o shader. */
export function setTriplanarScale(material, escala) {
  const dados = material.userData.__triplanar;
  if (!dados) return false;

  dados.escala = escala;

  const shader = material.userData.__shader;
  if (shader?.uniforms?.uTriplanarScale) {
    shader.uniforms.uTriplanarScale.value = escala;
  }

  return true;
}

// ── Biblioteca de materiais ──────────────────────────────────────────────

/**
 * Materiais de arquitetura com parâmetros PBR plausíveis.
 *
 * São valores de referência, não medidos: metais têm metalness alta e
 * rugosidade baixa; dielétricos (concreto, madeira, tecido) têm metalness
 * zero e rugosidade alta. Vidro usa transmissão.
 */
export const MATERIAL_PRESETS = {
  concreto: {
    label: t('Concreto'),
    color: 0x9e9c98,
    roughness: 0.92,
    metalness: 0,
    textura: 'ruido',
    escalaTextura: 0.35,
  },
  concreto_aparente: {
    label: t('Concreto aparente'),
    color: 0x8b8985,
    roughness: 0.85,
    metalness: 0,
    textura: 'ruido',
    escalaTextura: 0.6,
  },
  madeira: {
    label: t('Madeira'),
    color: 0x9c6b3f,
    roughness: 0.6,
    metalness: 0,
    textura: 'madeira',
    escalaTextura: 0.5,
  },
  madeira_escura: {
    label: t('Madeira escura'),
    color: 0x5c3a22,
    roughness: 0.5,
    metalness: 0,
    textura: 'madeira',
    escalaTextura: 0.5,
  },
  aco: {
    label: t('Aço escovado'),
    color: 0xb8bcc0,
    roughness: 0.35,
    metalness: 0.9,
    textura: 'escovado',
    escalaTextura: 1,
  },
  aluminio: {
    label: t('Alumínio'),
    color: 0xd6d9dc,
    roughness: 0.28,
    metalness: 0.95,
    textura: 'escovado',
    escalaTextura: 1,
  },
  vidro: {
    label: t('Vidro'),
    color: 0xdcecf2,
    roughness: 0.05,
    metalness: 0,
    opacity: 0.25,
    transparent: true,
    textura: null,
  },
  vidro_fume: {
    label: t('Vidro fumê'),
    color: 0x3d4a52,
    roughness: 0.1,
    metalness: 0,
    opacity: 0.45,
    transparent: true,
    textura: null,
  },
  pintura_branca: {
    label: t('Pintura branca'),
    color: 0xf2f2ef,
    roughness: 0.8,
    metalness: 0,
    textura: null,
  },
  pintura_fosca: {
    label: t('Pintura fosca (cor)'),
    color: 0xcccccc,
    roughness: 0.95,
    metalness: 0,
    textura: null,
  },
  carpete: {
    label: t('Carpete'),
    color: 0x555b62,
    roughness: 1,
    metalness: 0,
    textura: 'ruido',
    escalaTextura: 2,
  },
  tijolo: {
    label: t('Tijolo'),
    color: 0x9c5540,
    roughness: 0.88,
    metalness: 0,
    textura: 'tijolo',
    escalaTextura: 0.4,
  },
};

/**
 * Gera uma textura procedural em canvas.
 *
 * Procedural em vez de arquivo de imagem por dois motivos: não adiciona
 * megabytes ao bundle e funciona offline, sem depender de CDN.
 *
 * @param {'ruido'|'madeira'|'escovado'|'tijolo'} tipo
 * @param {number} [tamanho]
 * @returns {THREE.CanvasTexture}
 */
export function proceduralTexture(tipo, tamanho = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = tamanho;
  canvas.height = tamanho;

  const ctx = canvas.getContext('2d');

  switch (tipo) {
    case 'ruido':
      desenharRuido(ctx, tamanho);
      break;
    case 'madeira':
      desenharMadeira(ctx, tamanho);
      break;
    case 'escovado':
      desenharEscovado(ctx, tamanho);
      break;
    case 'tijolo':
      desenharTijolo(ctx, tamanho);
      break;
    default:
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tamanho, tamanho);
  }

  const textura = new THREE.CanvasTexture(canvas);
  textura.wrapS = THREE.RepeatWrapping;
  textura.wrapT = THREE.RepeatWrapping;
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  textura.name = `procedural_${tipo}`;

  return textura;
}

/** Ruído em escala de cinza — base para concreto e carpete. */
function desenharRuido(ctx, tamanho) {
  const imagem = ctx.createImageData(tamanho, tamanho);
  const dados = imagem.data;

  for (let i = 0; i < dados.length; i += 4) {
    // Faixa estreita em torno do branco: a textura modula a cor base do
    // material, não a substitui.
    const valor = 200 + Math.random() * 55;
    dados[i] = valor;
    dados[i + 1] = valor;
    dados[i + 2] = valor;
    dados[i + 3] = 255;
  }

  ctx.putImageData(imagem, 0, 0);
}

/** Veios verticais com variação suave. */
function desenharMadeira(ctx, tamanho) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tamanho, tamanho);

  for (let x = 0; x < tamanho; x++) {
    // Soma de senos com frequências diferentes imita a irregularidade
    // dos anéis de crescimento.
    const veio =
      Math.sin(x * 0.08) * 0.5 + Math.sin(x * 0.21 + 1.3) * 0.3 + Math.sin(x * 0.53) * 0.2;

    const tom = 205 + veio * 40 + (Math.random() - 0.5) * 12;

    ctx.fillStyle = `rgb(${tom}, ${tom * 0.95}, ${tom * 0.88})`;
    ctx.fillRect(x, 0, 1, tamanho);
  }
}

/** Riscos horizontais finos — metal escovado. */
function desenharEscovado(ctx, tamanho) {
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, tamanho, tamanho);

  for (let i = 0; i < tamanho * 3; i++) {
    const y = Math.random() * tamanho;
    const brilho = 200 + Math.random() * 55;

    ctx.strokeStyle = `rgba(${brilho}, ${brilho}, ${brilho}, 0.35)`;
    ctx.lineWidth = Math.random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(tamanho, y);
    ctx.stroke();
  }
}

/** Fiadas alternadas com junta de argamassa. */
function desenharTijolo(ctx, tamanho) {
  const alturaFiada = tamanho / 8;
  const larguraTijolo = tamanho / 4;
  const junta = Math.max(2, tamanho / 128);

  ctx.fillStyle = '#c8c4bc';
  ctx.fillRect(0, 0, tamanho, tamanho);

  for (let linha = 0; linha < 8; linha++) {
    // Amarração: fiadas ímpares deslocam meio tijolo.
    const deslocamento = linha % 2 === 0 ? 0 : larguraTijolo / 2;

    for (let coluna = -1; coluna < 5; coluna++) {
      const x = coluna * larguraTijolo + deslocamento;
      const y = linha * alturaFiada;

      const variacao = 0.88 + Math.random() * 0.24;
      const r = Math.min(255, 235 * variacao);
      const g = Math.min(255, 225 * variacao);
      const b = Math.min(255, 218 * variacao);

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x + junta, y + junta, larguraTijolo - junta * 2, alturaFiada - junta * 2);
    }
  }
}

/**
 * Monta um MeshStandardMaterial a partir de um preset.
 *
 * @param {keyof typeof MATERIAL_PRESETS} nome
 * @param {{cor?: number}} [options]
 */
export function materialFromPreset(nome, options = {}) {
  const preset = MATERIAL_PRESETS[nome];
  if (!preset) return null;

  const material = new THREE.MeshStandardMaterial({
    name: preset.label,
    color: options.cor ?? preset.color,
    roughness: preset.roughness,
    metalness: preset.metalness,
    opacity: preset.opacity ?? 1,
    transparent: Boolean(preset.transparent),
    side: THREE.DoubleSide,
  });

  if (preset.transparent) {
    material.depthWrite = false;
  }

  if (preset.textura) {
    const textura = proceduralTexture(preset.textura);
    applyTriplanar(material, textura, { escala: preset.escalaTextura ?? 1 });
  }

  material.userData.__preset = nome;

  return material;
}

/** Opções prontas para popular um `<select>`. */
export function presetList() {
  return Object.entries(MATERIAL_PRESETS).map(([value, preset]) => ({
    value,
    label: preset.label,
  }));
}
