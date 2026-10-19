import * as THREE from 'three';

/**
 * Procedural 3D Architectural & Mesh Samples Generator
 * Allows instant testing of GLB Editor & Converter features
 */

export function createModernVillaSample() {
  const group = new THREE.Group();
  group.name = 'Modern_Villa_Project';

  // Main Concrete Foundation & Slab
  const slabGeo = new THREE.BoxGeometry(18, 0.4, 14);
  const slabMat = new THREE.MeshStandardMaterial({
    color: 0x3a3d40,
    roughness: 0.8,
    metalness: 0.1,
    name: 'Concrete_Slab',
  });
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.y = -0.2;
  slab.receiveShadow = true;
  group.add(slab);

  // Ground Floor Walls (Architectural Glass & Concrete)
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf0ece1,
    roughness: 0.4,
    metalness: 0.05,
    name: 'Wall_Stucco',
  });

  const wall1Geo = new THREE.BoxGeometry(0.3, 3.2, 10);
  const wall1 = new THREE.Mesh(wall1Geo, wallMat);
  wall1.position.set(-6, 1.6, 0);
  wall1.castShadow = true;
  wall1.receiveShadow = true;
  group.add(wall1);

  const wall2Geo = new THREE.BoxGeometry(10, 3.2, 0.3);
  const wall2 = new THREE.Mesh(wall2Geo, wallMat);
  wall2.position.set(-1.1, 1.6, -5);
  wall2.castShadow = true;
  wall2.receiveShadow = true;
  group.add(wall2);

  // Cantilevered Upper Floor (Wooden Facade)
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0xa26d3e,
    roughness: 0.6,
    metalness: 0.1,
    name: 'Timber_Cladding',
  });
  const upperFloorGeo = new THREE.BoxGeometry(12, 3.5, 9);
  const upperFloor = new THREE.Mesh(upperFloorGeo, woodMat);
  upperFloor.position.set(2, 4.8, 1);
  upperFloor.castShadow = true;
  upperFloor.receiveShadow = true;
  group.add(upperFloor);

  // Large Panoramic Glass Curtain Wall
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x88ccee,
    transparent: true,
    opacity: 0.35,
    roughness: 0.05,
    metalness: 0.9,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    name: 'Architectural_Glass',
  });
  const glassGeo = new THREE.BoxGeometry(8, 3.0, 0.1);
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(0, 1.6, 4.9);
  group.add(glass);

  // Architectural Columns / Pillars (Black Steel)
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    metalness: 0.95,
    roughness: 0.2,
    name: 'Structural_Steel',
  });
  const pillarGeo = new THREE.CylinderGeometry(0.2, 0.2, 3.2, 16);
  const p1 = new THREE.Mesh(pillarGeo, steelMat);
  p1.position.set(6, 1.6, 4.5);
  p1.castShadow = true;
  group.add(p1);

  const p2 = p1.clone();
  p2.position.set(6, 1.6, -2);
  group.add(p2);

  // Roof Overhang
  const roofGeo = new THREE.BoxGeometry(14, 0.3, 11);
  const roof = new THREE.Mesh(roofGeo, slabMat);
  roof.position.set(2, 6.7, 1);
  roof.castShadow = true;
  group.add(roof);

  return group;
}

export function createSkyscraperSample() {
  const group = new THREE.Group();
  group.name = 'Architectural_Skyscraper';

  const floors = 16;
  const floorHeight = 1.2;
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x22252a,
    metalness: 0.9,
    roughness: 0.3,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x4488aa,
    transparent: true,
    opacity: 0.4,
    roughness: 0.1,
    metalness: 0.8,
  });

  for (let i = 0; i < floors; i++) {
    const scale = 1.0 - i * 0.03;
    const y = i * floorHeight + floorHeight / 2;

    const slab = new THREE.Mesh(new THREE.BoxGeometry(6 * scale, 0.15, 6 * scale), steelMat);
    slab.position.y = y - 0.5;
    slab.castShadow = true;
    group.add(slab);

    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(5.6 * scale, floorHeight - 0.2, 5.6 * scale),
      glassMat
    );
    glass.position.y = y;
    group.add(glass);
  }

  return group;
}

export function createGearMechanicalSample() {
  const group = new THREE.Group();
  group.name = 'Mechanical_Gear_Component';

  const gearGeo = new THREE.CylinderGeometry(3, 3, 0.8, 32);
  const gearMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37, // Gold metallic
    metalness: 0.9,
    roughness: 0.25,
    name: 'Polished_Brass',
  });
  const mainGear = new THREE.Mesh(gearGeo, gearMat);
  mainGear.castShadow = true;
  mainGear.receiveShadow = true;
  group.add(mainGear);

  // Teeth
  const toothGeo = new THREE.BoxGeometry(0.5, 0.8, 0.8);
  const numTeeth = 16;
  for (let i = 0; i < numTeeth; i++) {
    const angle = (i / numTeeth) * Math.PI * 2;
    const tooth = new THREE.Mesh(toothGeo, gearMat);
    tooth.position.set(Math.cos(angle) * 3.2, 0, Math.sin(angle) * 3.2);
    tooth.rotation.y = -angle;
    tooth.castShadow = true;
    group.add(tooth);
  }

  return group;
}

export function createTorusKnotSample() {
  const geo = new THREE.TorusKnotGeometry(2.5, 0.8, 128, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a2be2,
    metalness: 0.7,
    roughness: 0.2,
    name: 'Neon_Knot_Material',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Torus_Knot_Mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
