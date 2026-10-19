import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  diagnose,
  hasImageData,
  repairMaterials,
  sanitizeForExport,
  upgradeToPBR,
} from '../src/utils/materialRepair.js';

/**
 * Reproduz o material que o ColladaLoader produz a partir de um .dae do
 * SketchUp/Lumion: `<transparency>0</transparency>` com `opaque="A_ONE"`
 * resulta em `opacity = 0` — o modelo inteiro fica invisível.
 */
function materialColladaQuebrado() {
  return new THREE.MeshPhongMaterial({
    name: 'Parede',
    color: 0xcc9966,
    opacity: 0,
    transparent: true,
    shininess: 30,
  });
}

function cena(...materiais) {
  const grupo = new THREE.Group();

  for (const [i, material] of materiais.entries()) {
    const geometria = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometria, material);
    mesh.name = `Mesh_${i}`;
    grupo.add(mesh);
  }

  return grupo;
}

describe('repairMaterials — transparência do Collada', () => {
  it('torna opaco o material com opacidade zero', () => {
    const material = materialColladaQuebrado();
    const relatorio = repairMaterials(cena(material), { format: 'dae' });

    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
    expect(relatorio.transparenciaCorrigida).toBe(1);
  });

  it('preserva transparência legítima de vidro', () => {
    const vidro = new THREE.MeshStandardMaterial({ opacity: 0.35, transparent: true });
    const relatorio = repairMaterials(cena(vidro), { format: 'dae' });

    expect(vidro.opacity).toBeCloseTo(0.35, 5);
    expect(vidro.transparent).toBe(true);
    expect(relatorio.transparenciaCorrigida).toBe(0);
  });

  it('não mexe em material com mapa de alpha', () => {
    const folhagem = new THREE.MeshStandardMaterial({ opacity: 0, transparent: true });
    folhagem.alphaMap = new THREE.Texture();

    repairMaterials(cena(folhagem), { format: 'dae' });

    expect(folhagem.opacity).toBe(0);
  });

  it('normaliza transparent=true com opacidade 1', () => {
    const material = new THREE.MeshStandardMaterial({ opacity: 1, transparent: true });
    repairMaterials(cena(material), { format: 'dae' });

    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
  });

  it('não mexe na transparência de arquivos glTF', () => {
    // A spec glTF define alpha com precisão; opacidade zero ali é intencional.
    const material = new THREE.MeshStandardMaterial({ opacity: 0, transparent: true });
    const relatorio = repairMaterials(cena(material), { format: 'glb' });

    expect(relatorio.transparenciaCorrigida).toBe(0);
    expect(material.opacity).toBe(0);
  });

  it('guarda o valor original para auditoria', () => {
    const material = materialColladaQuebrado();
    repairMaterials(cena(material), { format: 'dae' });

    expect(material.userData.__c3dOpacidadeOriginal).toBe(0);
  });
});

describe('repairMaterials — face dupla', () => {
  it('aplica DoubleSide em modelos de arquitetura', () => {
    const material = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
    const relatorio = repairMaterials(cena(material), { format: 'dae' });

    expect(material.side).toBe(THREE.DoubleSide);
    expect(relatorio.doubleSideAplicado).toBe(1);
  });

  it('não aplica em STL, que é sólido fechado', () => {
    const material = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
    repairMaterials(cena(material), { format: 'stl' });

    expect(material.side).toBe(THREE.FrontSide);
  });

  it('respeita a opção explícita', () => {
    const material = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
    repairMaterials(cena(material), { format: 'stl', forceDoubleSide: true });

    expect(material.side).toBe(THREE.DoubleSide);
  });
});

describe('repairMaterials — texturas', () => {
  it('define sRGB no mapa de cor', () => {
    const material = new THREE.MeshStandardMaterial();
    material.map = new THREE.Texture();
    material.map.colorSpace = THREE.NoColorSpace;

    const relatorio = repairMaterials(cena(material), { format: 'dae' });

    expect(material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(relatorio.texturasCorrigidas).toBe(1);
  });

  it('não altera o colorSpace de mapas de dados', () => {
    const material = new THREE.MeshStandardMaterial();
    material.normalMap = new THREE.Texture();
    material.normalMap.colorSpace = THREE.NoColorSpace;

    repairMaterials(cena(material), { format: 'dae' });

    // Normal map é dado geométrico, não cor: precisa continuar linear.
    expect(material.normalMap.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('habilita repetição para ladrilhar fachadas', () => {
    const material = new THREE.MeshStandardMaterial();
    material.map = new THREE.Texture();
    material.map.wrapS = THREE.ClampToEdgeWrapping;

    repairMaterials(cena(material), { format: 'dae' });

    expect(material.map.wrapS).toBe(THREE.RepeatWrapping);
    expect(material.map.wrapT).toBe(THREE.RepeatWrapping);
  });

  it('neutraliza emissivo branco', () => {
    const material = new THREE.MeshStandardMaterial({ emissive: 0xffffff });
    repairMaterials(cena(material), { format: 'dae' });

    expect(material.emissive.getHex()).toBe(0x000000);
  });
});

describe('repairMaterials — robustez', () => {
  it('lida com raiz nula', () => {
    expect(repairMaterials(null).materiais).toBe(0);
  });

  it('conta cada material compartilhado uma única vez', () => {
    const compartilhado = new THREE.MeshStandardMaterial();
    const relatorio = repairMaterials(cena(compartilhado, compartilhado), { format: 'dae' });

    expect(relatorio.materiais).toBe(1);
  });

  it('processa arrays de material (multi-material do Revit)', () => {
    const a = materialColladaQuebrado();
    const b = materialColladaQuebrado();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [a, b]);
    const grupo = new THREE.Group();
    grupo.add(mesh);

    const relatorio = repairMaterials(grupo, { format: 'dae' });

    expect(relatorio.materiais).toBe(2);
    expect(relatorio.transparenciaCorrigida).toBe(2);
  });
});

describe('upgradeToPBR', () => {
  it('converte Phong para Standard', () => {
    const grupo = cena(new THREE.MeshPhongMaterial({ color: 0xff0000, shininess: 100 }));
    const convertidos = upgradeToPBR(grupo);

    expect(convertidos).toBe(1);
    expect(grupo.children[0].material.isMeshStandardMaterial).toBe(true);
    expect(grupo.children[0].material.color.getHex()).toBe(0xff0000);
  });

  it('mapeia shininess para roughness', () => {
    const brilhante = cena(new THREE.MeshPhongMaterial({ shininess: 1000 }));
    const fosco = cena(new THREE.MeshPhongMaterial({ shininess: 0 }));

    upgradeToPBR(brilhante);
    upgradeToPBR(fosco);

    expect(brilhante.children[0].material.roughness).toBeLessThan(
      fosco.children[0].material.roughness
    );
  });

  it('não toca em material que já é Standard', () => {
    const grupo = cena(new THREE.MeshStandardMaterial());

    expect(upgradeToPBR(grupo)).toBe(0);
  });

  it('preserva a textura ao converter', () => {
    const phong = new THREE.MeshPhongMaterial();
    phong.map = new THREE.Texture();

    const grupo = cena(phong);
    upgradeToPBR(grupo);

    expect(grupo.children[0].material.map).toBe(phong.map);
  });
});

describe('diagnose', () => {
  it('detecta materiais invisíveis', () => {
    const { problemas, estatisticas } = diagnose(cena(materialColladaQuebrado()));

    expect(estatisticas.invisiveis).toBe(1);
    expect(problemas.some((p) => p.includes('opacidade zero'))).toBe(true);
  });

  it('avisa quando nenhum material tem textura', () => {
    const { problemas } = diagnose(cena(new THREE.MeshStandardMaterial()));

    expect(problemas.some((p) => p.includes('textura'))).toBe(true);
  });

  it('conta malhas e materiais', () => {
    const { estatisticas } = diagnose(
      cena(new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial())
    );

    expect(estatisticas.malhas).toBe(2);
    expect(estatisticas.materiais).toBe(2);
  });

  it('lida com raiz nula', () => {
    expect(diagnose(null).problemas).toEqual([]);
  });
});

describe('hasImageData', () => {
  it('rejeita textura sem imagem', () => {
    expect(hasImageData(new THREE.Texture())).toBe(false);
  });

  it('rejeita textura cujo arquivo falhou (naturalWidth zero)', () => {
    const textura = new THREE.Texture();
    textura.image = { naturalWidth: 0, naturalHeight: 0, width: 0, height: 0 };

    expect(hasImageData(textura)).toBe(false);
  });

  it('aceita imagem com dimensões válidas', () => {
    const textura = new THREE.Texture();
    textura.image = { width: 512, height: 512, naturalWidth: 512 };

    expect(hasImageData(textura)).toBe(true);
  });

  it('aceita textura comprimida com mipmaps', () => {
    const textura = new THREE.Texture();
    textura.mipmaps = [{ data: new Uint8Array(16), width: 4, height: 4 }];

    expect(hasImageData(textura)).toBe(true);
  });

  it('rejeita null', () => {
    expect(hasImageData(null)).toBe(false);
  });
});

describe('sanitizeForExport', () => {
  /** Reproduz o material que quebra o GLTFExporter. */
  function materialComTexturaQuebrada() {
    const material = new THREE.MeshStandardMaterial({ name: 'Parede' });
    material.map = new THREE.Texture(); // image === undefined
    return material;
  }

  it('remove a referência à textura sem imagem', () => {
    const material = materialComTexturaQuebrada();
    const grupo = cena(material);

    const relatorio = sanitizeForExport(grupo);

    expect(relatorio.texturasRemovidas).toBe(1);
    expect(grupo.children[0].material.map).toBeNull();
  });

  it('NÃO altera o material original — só a cópia exportada', () => {
    // O objeto exportado é um clone que compartilha materiais por
    // referência; mexer neles estragaria o modelo da viewport.
    const material = materialComTexturaQuebrada();
    const grupo = cena(material);

    sanitizeForExport(grupo);

    expect(material.map).not.toBeNull();
    expect(grupo.children[0].material).not.toBe(material);
  });

  it('preserva texturas válidas', () => {
    const material = new THREE.MeshStandardMaterial();
    material.map = new THREE.Texture();
    material.map.image = { width: 256, height: 256, naturalWidth: 256 };

    const grupo = cena(material);
    const relatorio = sanitizeForExport(grupo);

    expect(relatorio.texturasRemovidas).toBe(0);
    expect(grupo.children[0].material).toBe(material);
  });

  it('limpa vários slots do mesmo material', () => {
    const material = new THREE.MeshStandardMaterial();
    material.map = new THREE.Texture();
    material.normalMap = new THREE.Texture();
    material.roughnessMap = new THREE.Texture();

    const relatorio = sanitizeForExport(cena(material));

    expect(relatorio.texturasRemovidas).toBe(3);
    expect(relatorio.materiaisAjustados).toBe(1);
    expect(relatorio.slots).toEqual(expect.arrayContaining(['map', 'normalMap', 'roughnessMap']));
  });

  it('reaproveita o clone em materiais compartilhados', () => {
    const material = materialComTexturaQuebrada();
    const grupo = cena(material, material);

    const relatorio = sanitizeForExport(grupo);

    expect(relatorio.materiaisAjustados).toBe(1);
    expect(grupo.children[0].material).toBe(grupo.children[1].material);
  });

  it('normaliza transparência ao remover alphaMap', () => {
    const material = new THREE.MeshStandardMaterial({ opacity: 1, transparent: true });
    material.alphaMap = new THREE.Texture();

    const grupo = cena(material);
    sanitizeForExport(grupo);

    expect(grupo.children[0].material.transparent).toBe(false);
  });

  it('trata arrays de material', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [
      materialComTexturaQuebrada(),
      materialComTexturaQuebrada(),
    ]);
    const grupo = new THREE.Group();
    grupo.add(mesh);

    expect(sanitizeForExport(grupo).texturasRemovidas).toBe(2);
  });

  it('lida com raiz nula', () => {
    expect(sanitizeForExport(null).texturasRemovidas).toBe(0);
  });
});
