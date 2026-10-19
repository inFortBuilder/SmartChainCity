import { importOptional } from './errors.js';

/**
 * Constrói um Document do glTF-Transform a partir de geometria bruta.
 *
 * Fazemos isso em vez de usar o GLTFExporter do Three.js porque o exporter
 * depende de APIs de browser (canvas, FileReader, ImageData) e é instável
 * em Node.
 *
 * @param {import('./mesh-import.js').MeshData[]} meshes
 * @param {{generator?: string}} [options]
 */
export async function buildDocument(meshes, options = {}) {
  const { Document } = await importOptional('@gltf-transform/core', 'gerar arquivos glTF');

  const doc = new Document();
  doc.getRoot().getAsset().generator = options.generator ?? 'SCC Builder 2.0.0';

  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');

  // Materiais são deduplicados por cor para não gerar um material por mesh.
  /** @type {Map<string, unknown>} */
  const materialCache = new Map();

  for (const mesh of meshes) {
    const primitive = doc.createPrimitive();

    primitive.setAttribute(
      'POSITION',
      doc
        .createAccessor(`${mesh.name}_POSITION`)
        .setType('VEC3')
        .setArray(mesh.positions)
        .setBuffer(buffer)
    );

    if (mesh.normals) {
      primitive.setAttribute(
        'NORMAL',
        doc
          .createAccessor(`${mesh.name}_NORMAL`)
          .setType('VEC3')
          .setArray(mesh.normals)
          .setBuffer(buffer)
      );
    }

    if (mesh.uvs) {
      primitive.setAttribute(
        'TEXCOORD_0',
        doc.createAccessor(`${mesh.name}_UV`).setType('VEC2').setArray(mesh.uvs).setBuffer(buffer)
      );
    }

    if (mesh.indices) {
      const vertexCount = mesh.positions.length / 3;
      // glTF exige o menor tipo inteiro que comporte os índices.
      const array = vertexCount > 65535 ? mesh.indices : new Uint16Array(mesh.indices);
      primitive.setIndices(
        doc.createAccessor(`${mesh.name}_INDEX`).setType('SCALAR').setArray(array).setBuffer(buffer)
      );
    }

    const key = mesh.color.map((c) => c.toFixed(3)).join(',');
    let material = materialCache.get(key);
    if (!material) {
      material = doc
        .createMaterial(`Material_${materialCache.size}`)
        .setBaseColorFactor([...mesh.color, 1])
        .setRoughnessFactor(0.85)
        .setMetallicFactor(0.05)
        .setDoubleSided(true);
      materialCache.set(key, material);
    }
    primitive.setMaterial(material);

    const gltfMesh = doc.createMesh(mesh.name).addPrimitive(primitive);
    scene.addChild(doc.createNode(mesh.name).setMesh(gltfMesh));
  }

  return doc;
}

/**
 * Aplica correção de eixo e escala na raiz da cena.
 *
 * Z-up (3ds Max, Revit, AutoCAD) → Y-up (glTF, Unity, Three.js) é uma
 * rotação de -90° em X. Aplicamos como quaternion no nó raiz.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{flipAxis?: boolean, scale?: number}} options
 */
export function applyTransform(doc, options = {}) {
  const { flipAxis = false, scale = 1 } = options;

  if (!flipAxis && scale === 1) {
    return doc;
  }

  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return doc;

  const root = doc.createNode('SccBuilder_Root');

  // -90° em torno de X: q = (sin(-45°), 0, 0, cos(-45°))
  const HALF_SQRT2 = Math.SQRT1_2;
  if (flipAxis) {
    root.setRotation([-HALF_SQRT2, 0, 0, HALF_SQRT2]);
  }
  if (scale !== 1) {
    root.setScale([scale, scale, scale]);
  }

  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    root.addChild(child);
  }
  scene.addChild(root);

  return doc;
}

/**
 * Conta os triângulos de um Document já montado.
 * @param {import('@gltf-transform/core').Document} doc
 */
export function countDocumentTriangles(doc) {
  let total = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const position = primitive.getAttribute('POSITION');
      const count = indices ? indices.getCount() : (position?.getCount() ?? 0);
      total += Math.floor(count / 3);
    }
  }

  return total;
}
