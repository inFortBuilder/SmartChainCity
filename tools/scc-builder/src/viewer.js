import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { removeAndDispose } from './utils/dispose.js';
import {
  applyProperties,
  collectMaterials,
  materialsOf,
  setRenderMode,
} from './utils/materials.js';
import {
  analyzeManifold,
  areaToCm2,
  signedVolume,
  surfaceArea,
  volumeToCm3,
} from './utils/geometry.js';
import { captureTransform } from './utils/history.js';
import { tuneForRendering } from './utils/optimizer.js';

/**
 * Motor de viewport do SCC Builder.
 *
 * Correções em relação à v1:
 *  F1  pivot: a matemática de centralização estava errada e o modelo derivava
 *      a cada clique em "Centralizar Pivot".
 *  F4  dispose: geometrias/materiais/texturas nunca eram liberados.
 *  F2  modos de render agora são reversíveis (ver utils/materials.js).
 *  F9  o slicer opera na bounding box do modelo, não em coordenadas de mundo.
 *  F10 seleção por clique na viewport (raycast) com contorno.
 *  A16 setAnimationLoop com pausa quando a aba está oculta.
 *  A17 ResizeObserver no container em vez de listener no window.
 */
export class StudioViewer {
  /**
   * @param {HTMLElement} container
   * @param {{onSelect?: (object: THREE.Object3D|null) => void}} [callbacks]
   */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.currentModel = null;
    this.selectedObject = null;
    this.renderMode = 'shaded';
    this.disposed = false;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerDownAt = null;

    this.modelBounds = new THREE.Box3();
    this.clipPlanes = {
      x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), Number.POSITIVE_INFINITY),
      y: new THREE.Plane(new THREE.Vector3(0, -1, 0), Number.POSITIVE_INFINITY),
      z: new THREE.Plane(new THREE.Vector3(0, 0, -1), Number.POSITIVE_INFINITY),
    };
    this.clippingEnabled = false;

    this.colliders = [];

    /** Zoom por área: desenhar um retângulo e enquadrar aquela região. */
    this.areaZoom = { ativo: false, arrastando: false, inicio: null, overlay: null };

    this.#initScene();
    this.#initLights();
    this.#initControls();
    this.#initHelpers();
    this.#initSelection();
    this.#initResize();

    this.renderer.setAnimationLoop(() => this.#tick());
  }

  // ── Configuração ───────────────────────────────────────────────────────

  #initScene() {
    const { clientWidth: width, clientHeight: height } = this.container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1318);

    this.camera = new THREE.PerspectiveCamera(45, this.#aspect(), 0.1, 5000);
    this.camera.position.set(12, 10, 16);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width || 1, height || 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.localClippingEnabled = true;

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentTexture = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.environmentTexture;

    this.container.appendChild(this.renderer.domElement);
  }

  #aspect() {
    const { clientWidth: w, clientHeight: h } = this.container;

    return h > 0 ? w / h : 1;
  }

  #initLights() {
    this.lights = new THREE.Group();
    this.lights.name = 'SccBuilder_Lights';
    this.scene.add(this.lights);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.lights.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.dirLight.position.set(15, 25, 15);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.bias = -0.0005;
    this.lights.add(this.dirLight);
    this.lights.add(this.dirLight.target);

    this.fillLight = new THREE.DirectionalLight(0xaaccff, 0.4);
    this.fillLight.position.set(-15, 10, -15);
    this.lights.add(this.fillLight);
  }

  #initControls() {
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.05;
    this.orbit.target.set(0, 2, 0);

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.size = 0.8;

    // Undo/redo: capturamos o estado no início do arrasto e comparamos no
    // fim. Um arrasto inteiro vira UM comando, não um por frame.
    this.gizmo.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;

      if (event.value) {
        this.transformSnapshot = this.selectedObject ? captureTransform(this.selectedObject) : null;

        return;
      }

      if (this.transformSnapshot && this.selectedObject) {
        const after = captureTransform(this.selectedObject);

        if (!sameTransform(this.transformSnapshot, after)) {
          this.callbacks.onTransform?.(this.selectedObject, this.transformSnapshot, after);
        }
      }

      this.transformSnapshot = null;
    });

    this.scene.add(this.gizmo.getHelper());
  }

  #initHelpers() {
    this.grid = new THREE.GridHelper(40, 40, 0x00f0ff, 0x223344);
    this.grid.position.y = -0.01;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(3);
    this.axes.position.set(-8, 0.05, -8);
    this.scene.add(this.axes);

    // Contorno do objeto selecionado
    this.selectionBox = new THREE.BoxHelper(undefined, 0x00f0ff);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);
  }

  /**
   * F10 — seleção por clique na viewport.
   * Distingue clique de arrasto de câmera comparando a distância percorrida.
   */
  #initSelection() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointerdown', (event) => {
      if (this.areaZoom.ativo) return;
      this.pointerDownAt = { x: event.clientX, y: event.clientY };
    });

    canvas.addEventListener('pointerup', (event) => {
      if (this.areaZoom.ativo) return;
      if (!this.pointerDownAt) return;

      const moved = Math.hypot(
        event.clientX - this.pointerDownAt.x,
        event.clientY - this.pointerDownAt.y
      );
      this.pointerDownAt = null;

      if (moved > 4 || this.gizmo.dragging) return;

      this.#pick(event);
    });
  }

  #pick(event) {
    if (!this.currentModel) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.currentModel, true);
    const hit = hits.find((item) => item.object.isMesh);

    this.select(hit ? hit.object : null);
    this.callbacks.onSelect?.(hit ? hit.object : null);
  }

  /** A17 — o canvas acompanha o container, não a janela. */
  #initResize() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    // A16 — o loop pula o desenho com a aba oculta, para não gastar GPU em
    // segundo plano. Ao voltar, redesenhamos na hora: se o modelo mudou
    // enquanto a aba estava escondida, o canvas ainda mostra o quadro
    // antigo até o próximo tick.
    this.onVisibilityChange = () => {
      if (!document.hidden) this.renderNow();
    };

    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Força um quadro imediato, fora do ciclo normal. */
  renderNow() {
    if (this.disposed) return;

    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // ── Ciclo de renderização ──────────────────────────────────────────────

  #tick() {
    if (this.disposed) return;

    // A16 — não desperdiça GPU com a aba em segundo plano.
    if (document.hidden) return;

    this.orbit.update();

    if (this.selectionBox.visible && this.selectedObject) {
      this.selectionBox.update();
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ── Modelo ─────────────────────────────────────────────────────────────

  /**
   * Substitui o modelo atual, liberando o anterior (F4).
   * @param {THREE.Object3D} object
   */
  setModel(object) {
    if (this.currentModel) {
      this.gizmo.detach();
      this.clearColliders();
      removeAndDispose(this.scene, this.currentModel);
    }

    this.currentModel = object;
    this.scene.add(object);

    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });

    // Frustum culling e ordenação por material (item 35).
    tuneForRendering(object);

    this.centerModel();
    this.frameCamera();
    this.select(null);

    return this.getStats();
  }

  /**
   * F1 — centraliza o modelo em XZ e apoia sua base em Y = 0.
   *
   * A v1 fazia `position.x += (position.x - center.x)`, correto apenas quando
   * a posição já era zero; chamadas repetidas faziam o modelo derivar. A
   * operação correta é subtrair o centro do bounding box em espaço de mundo.
   */
  centerModel() {
    if (!this.currentModel) return;

    const box = new THREE.Box3().setFromObject(this.currentModel);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());

    this.currentModel.position.x -= center.x;
    this.currentModel.position.y -= box.min.y;
    this.currentModel.position.z -= center.z;

    this.currentModel.updateMatrixWorld(true);
    this.modelBounds.setFromObject(this.currentModel);
  }

  /** Enquadra o modelo inteiro — o "ambiente". */
  frameCamera() {
    this.frameObject(this.currentModel, { adjustScene: true });
  }

  /** Enquadra apenas o objeto informado (ou a seleção atual). */
  frameSelection() {
    const alvo = this.selectedObject ?? this.currentModel;

    return this.frameObject(alvo, { padding: 2.1 });
  }

  /**
   * Aponta a câmera para um objeto e recua o suficiente para vê-lo inteiro.
   *
   * A distância vem da trigonometria do frustum: para um objeto de altura
   * `h` caber num campo de visão `fov`, a câmera precisa estar a
   * `h / 2 / tan(fov / 2)`. O padding dá a folga nas bordas.
   *
   * @param {THREE.Object3D|null} object
   * @param {{padding?: number, adjustScene?: boolean}} [options]
   */
  frameObject(object, options = {}) {
    if (!object) return false;

    const padding = options.padding ?? 1.8;

    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return false;

    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray()) || 1;
    const distance = this.#fitDistance(box, padding);

    // Mantém a direção de visão atual: enquadrar não deve girar a câmera.
    const direcao = this.camera.position.clone().sub(this.orbit.target);
    if (direcao.lengthSq() < 1e-8) direcao.set(1, 0.8, 1.2);
    direcao.normalize();

    this.camera.position.copy(center).addScaledVector(direcao, distance);

    this.camera.near = Math.max(distance / 1000, 0.001);
    this.camera.far = Math.max(distance * 100, maxDim * 100);
    this.camera.updateProjectionMatrix();

    this.orbit.target.copy(center);
    this.#applyZoomLimits(maxDim);
    this.orbit.update();

    if (options.adjustScene) this.#adjustSceneToModel(maxDim);

    return true;
  }

  /**
   * Distância de câmera necessária para o objeto caber na tela.
   *
   * Fonte única da verdade: `frameObject` a usa para posicionar a câmera e
   * `zoomPercent` a usa como referência de 100%. Se cada um calculasse por
   * conta própria, o indicador mostraria algo diferente de 100% logo após
   * um enquadramento — foi exatamente o que aconteceu (marcava 155%).
   *
   * @param {THREE.Box3} box
   * @param {number} padding
   */
  #fitDistance(box, padding = 1.8) {
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    const fov = THREE.MathUtils.degToRad(this.camera.fov);

    // O FOV horizontal também importa: um objeto largo e baixo precisa de
    // mais recuo do que a altura sozinha sugere.
    const fovHorizontal = 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect);
    const distanciaVertical = size.y / 2 / Math.tan(fov / 2);
    const distanciaHorizontal = Math.max(size.x, size.z) / 2 / Math.tan(fovHorizontal / 2);

    return Math.max(distanciaVertical, distanciaHorizontal, maxDim / 2) * padding;
  }

  /**
   * Limites de zoom proporcionais ao modelo.
   *
   * Sem isto, o scroll do mouse atravessa o modelo em cenas pequenas e mal
   * se move em cenas grandes.
   */
  #applyZoomLimits(maxDim) {
    this.orbit.minDistance = maxDim / 500;
    this.orbit.maxDistance = maxDim * 25;
  }

  /**
   * Aproxima ou afasta mantendo o alvo do orbit.
   *
   * @param {number} factor menor que 1 aproxima, maior afasta
   * @returns {number} distância resultante
   */
  zoom(factor) {
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const atual = offset.length();

    const distancia = THREE.MathUtils.clamp(
      atual * factor,
      this.orbit.minDistance || 0.01,
      this.orbit.maxDistance || Number.POSITIVE_INFINITY
    );

    this.camera.position.copy(this.orbit.target).add(offset.setLength(distancia));
    this.orbit.update();

    return distancia;
  }

  /** Um passo de aproximação (25%). */
  zoomIn(passo = 1.25) {
    return this.zoom(1 / passo);
  }

  /** Um passo de afastamento (25%). */
  zoomOut(passo = 1.25) {
    return this.zoom(passo);
  }

  /**
   * Zoom em percentual relativo ao enquadramento total da cena.
   * 100% = o modelo inteiro cabe na tela.
   */
  zoomPercent() {
    if (!this.currentModel) return 100;

    const box = new THREE.Box3().setFromObject(this.currentModel);
    if (box.isEmpty()) return 100;

    const referencia = this.#fitDistance(box);
    const atual = this.camera.position.distanceTo(this.orbit.target);

    return Math.round((referencia / Math.max(atual, 1e-6)) * 100);
  }

  /** Grid, luzes e sombras acompanham a escala do modelo. */
  #adjustSceneToModel(maxDim) {
    const gridSize = Math.ceil(maxDim * 2);
    this.grid.scale.setScalar(gridSize / 40);
    this.dirLight.position.set(maxDim, maxDim * 1.6, maxDim);

    const shadowExtent = maxDim * 1.5;
    Object.assign(this.dirLight.shadow.camera, {
      left: -shadowExtent,
      right: shadowExtent,
      top: shadowExtent,
      bottom: -shadowExtent,
      near: 0.1,
      far: maxDim * 8,
    });
    this.dirLight.shadow.camera.updateProjectionMatrix();
  }

  // ── Zoom por área (janela livre) ───────────────────────────────────────

  /**
   * Ativa o modo de zoom por área.
   *
   * É o "zoom janela" do AutoCAD/Revit: o usuário arrasta um retângulo sobre
   * a viewport e a câmera enquadra exatamente aquela região. Resolve o caso
   * em que se quer inspecionar um detalhe no meio da cena — enquadrar o
   * modelo inteiro é grosseiro demais e a lupa aproxima pelo centro, não
   * por onde interessa.
   *
   * @param {(ativo: boolean) => void} [onChange] avisa a UI sobre o estado
   */
  startAreaZoom(onChange) {
    if (this.areaZoom.ativo) {
      this.cancelAreaZoom();

      return false;
    }

    this.areaZoom.ativo = true;
    this.areaZoom.onChange = onChange;

    // O orbit precisa sair do caminho: o arrasto agora desenha o retângulo.
    this.orbit.enabled = false;
    this.renderer.domElement.style.cursor = 'crosshair';

    this.#bindAreaZoom();
    onChange?.(true);

    return true;
  }

  cancelAreaZoom() {
    if (!this.areaZoom.ativo) return;

    this.areaZoom.ativo = false;
    this.areaZoom.arrastando = false;
    this.areaZoom.inicio = null;

    this.#removeAreaOverlay();
    this.#unbindAreaZoom();

    this.orbit.enabled = true;
    this.renderer.domElement.style.cursor = '';

    this.areaZoom.onChange?.(false);
  }

  #bindAreaZoom() {
    const canvas = this.renderer.domElement;

    this.areaZoom.handlers = {
      down: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();

        this.areaZoom.arrastando = true;
        this.areaZoom.inicio = { x: event.clientX, y: event.clientY };
        this.#criarAreaOverlay();
      },

      move: (event) => {
        if (!this.areaZoom.arrastando) return;
        this.#atualizarAreaOverlay(event.clientX, event.clientY);
      },

      up: (event) => {
        if (!this.areaZoom.arrastando) return;

        this.areaZoom.arrastando = false;

        const inicio = this.areaZoom.inicio;
        const rect = canvas.getBoundingClientRect();

        const x1 = Math.min(inicio.x, event.clientX) - rect.left;
        const y1 = Math.min(inicio.y, event.clientY) - rect.top;
        const x2 = Math.max(inicio.x, event.clientX) - rect.left;
        const y2 = Math.max(inicio.y, event.clientY) - rect.top;

        this.#removeAreaOverlay();

        // Um clique sem arrasto é engano: sai do modo sem mexer na câmera.
        if (x2 - x1 < 12 || y2 - y1 < 12) {
          this.cancelAreaZoom();

          return;
        }

        this.zoomToArea({ x1, y1, x2, y2 });
        this.cancelAreaZoom();
      },
    };

    canvas.addEventListener('pointerdown', this.areaZoom.handlers.down);
    window.addEventListener('pointermove', this.areaZoom.handlers.move);
    window.addEventListener('pointerup', this.areaZoom.handlers.up);
  }

  #unbindAreaZoom() {
    const handlers = this.areaZoom.handlers;
    if (!handlers) return;

    this.renderer.domElement.removeEventListener('pointerdown', handlers.down);
    window.removeEventListener('pointermove', handlers.move);
    window.removeEventListener('pointerup', handlers.up);

    this.areaZoom.handlers = null;
  }

  #criarAreaOverlay() {
    this.#removeAreaOverlay();

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; pointer-events:none; z-index:9998;
      border:1.5px dashed #00f0ff; background:rgba(0,240,255,0.12);
      border-radius:2px;
    `;

    document.body.appendChild(overlay);
    this.areaZoom.overlay = overlay;
  }

  #atualizarAreaOverlay(x, y) {
    const overlay = this.areaZoom.overlay;
    const inicio = this.areaZoom.inicio;
    if (!overlay || !inicio) return;

    overlay.style.left = `${Math.min(inicio.x, x)}px`;
    overlay.style.top = `${Math.min(inicio.y, y)}px`;
    overlay.style.width = `${Math.abs(x - inicio.x)}px`;
    overlay.style.height = `${Math.abs(y - inicio.y)}px`;
  }

  #removeAreaOverlay() {
    this.areaZoom.overlay?.remove();
    this.areaZoom.overlay = null;
  }

  /**
   * Enquadra a região retangular informada, em pixels do canvas.
   *
   * Duas contas:
   *
   * 1. NOVO ALVO — o centro do retângulo precisa virar o centro da tela.
   *    Tentamos primeiro um raycast contra o modelo: se houver geometria sob
   *    o retângulo, focar nela é o que o usuário espera. Sem acerto, caímos
   *    no plano perpendicular à câmera que passa pelo alvo atual.
   *
   * 2. NOVA DISTÂNCIA — se o retângulo ocupa metade da largura da tela, o
   *    conteúdo precisa dobrar de tamanho, então a distância cai pela
   *    metade. Usamos a maior das duas frações (largura e altura) para que
   *    a região inteira caiba.
   *
   * @param {{x1:number, y1:number, x2:number, y2:number}} rect
   */
  zoomToArea(rect) {
    const canvas = this.renderer.domElement;
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;

    if (largura === 0 || altura === 0) return false;

    const centroX = (rect.x1 + rect.x2) / 2;
    const centroY = (rect.y1 + rect.y2) / 2;

    const ndcX = (centroX / largura) * 2 - 1;
    const ndcY = -(centroY / altura) * 2 + 1;

    // 1. Novo alvo
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    let novoAlvo = null;

    if (this.currentModel) {
      const hits = this.raycaster.intersectObject(this.currentModel, true);
      const hit = hits.find((item) => item.object.visible);
      if (hit) novoAlvo = hit.point.clone();
    }

    if (!novoAlvo) {
      const normal = this.camera.getWorldDirection(new THREE.Vector3());
      const plano = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.orbit.target);

      novoAlvo = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(plano, novoAlvo)) {
        novoAlvo = this.orbit.target.clone();
      }
    }

    // 2. Nova distância
    const fracao = Math.max((rect.x2 - rect.x1) / largura, (rect.y2 - rect.y1) / altura);
    const distanciaAtual = this.camera.position.distanceTo(this.orbit.target);

    const distancia = THREE.MathUtils.clamp(
      distanciaAtual * fracao,
      this.orbit.minDistance || 0.001,
      this.orbit.maxDistance || Number.POSITIVE_INFINITY
    );

    const direcao = this.camera.position.clone().sub(this.orbit.target).normalize();

    this.orbit.target.copy(novoAlvo);
    this.camera.position.copy(novoAlvo).addScaledVector(direcao, distancia);

    this.camera.near = Math.max(distancia / 1000, 0.001);
    this.camera.updateProjectionMatrix();
    this.orbit.update();

    return true;
  }

  // ── Seleção ────────────────────────────────────────────────────────────

  /** @param {THREE.Object3D|null} object */
  select(object) {
    this.selectedObject = object;

    if (object) {
      this.selectionBox.setFromObject(object);
      this.selectionBox.visible = true;
      if (this.gizmoMode && this.gizmoMode !== 'off') {
        this.gizmo.attach(object);
      }
    } else {
      this.selectionBox.visible = false;
      this.gizmo.detach();
    }
  }

  /** @param {'translate'|'rotate'|'scale'|'off'} mode */
  setGizmoMode(mode) {
    this.gizmoMode = mode;

    if (mode === 'off') {
      this.gizmo.detach();

      return;
    }

    this.gizmo.setMode(mode);
    if (this.selectedObject) {
      this.gizmo.attach(this.selectedObject);
    }
  }

  // ── Ferramentas de game engine ─────────────────────────────────────────

  /**
   * Z-up (CAD/BIM) ↔ Y-up (game engines).
   * @param {'Z-to-Y'|'Y-to-Z'|'reset'} type
   */
  flipAxis(type) {
    if (!this.currentModel) return;

    const rotations = {
      'Z-to-Y': -Math.PI / 2,
      'Y-to-Z': Math.PI / 2,
      reset: 0,
    };

    this.currentModel.rotation.set(rotations[type] ?? 0, 0, 0);
    this.currentModel.updateMatrixWorld(true);
    this.centerModel();
    this.frameCamera();
  }

  recalculateNormals() {
    if (!this.currentModel) return 0;

    let count = 0;
    this.currentModel.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.geometry.computeVertexNormals();
        child.geometry.normalsNeedUpdate = true;
        count++;
      }
    });

    return count;
  }

  /**
   * Colisores por malha, não uma única caixa da cena inteira.
   *
   * `convex` gera um casco convexo real — o formato que Unity (Mesh Collider
   * com Convex) e Unreal esperam para corpos dinâmicos. Box e sphere
   * continuam disponíveis por serem muito mais baratos em runtime.
   *
   * @param {'box'|'sphere'|'convex'} type
   * @param {boolean} perMesh
   */
  async generateColliders(type = 'box', perMesh = true) {
    if (!this.currentModel) return 0;

    if (type === 'convex') {
      return this.#generateConvexColliders(perMesh);
    }

    this.clearColliders();

    /** @type {THREE.Object3D[]} */
    const targets = [];
    if (perMesh) {
      this.currentModel.traverse((child) => {
        if (child.isMesh) targets.push(child);
      });
    } else {
      targets.push(this.currentModel);
    }

    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    });

    for (const target of targets) {
      const box = new THREE.Box3().setFromObject(target);
      if (box.isEmpty()) continue;

      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const geometry =
        type === 'sphere'
          ? new THREE.SphereGeometry(size.length() / 2, 12, 8)
          : new THREE.BoxGeometry(size.x, size.y, size.z);

      const collider = new THREE.Mesh(geometry, material);
      collider.name = `Collider_${type}_${target.name || 'mesh'}`;
      collider.position.copy(center);
      collider.userData.isCollider = true;
      collider.renderOrder = 999;

      this.scene.add(collider);
      this.colliders.push(collider);
    }

    return this.colliders.length;
  }

  /** Casco convexo por malha, via ConvexGeometry do Three.js. */
  async #generateConvexColliders(perMesh) {
    const { ConvexGeometry } = await import('three/examples/jsm/geometries/ConvexGeometry.js');

    this.clearColliders();

    /** @type {THREE.Mesh[]} */
    const targets = [];
    this.currentModel.traverse((child) => {
      if (child.isMesh) targets.push(child);
    });

    const groups = perMesh ? targets.map((mesh) => [mesh]) : [targets];

    const material = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      wireframe: true,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });

    for (const [index, group] of groups.entries()) {
      const points = collectPoints(group);
      // Menos de 4 pontos não formam um volume.
      if (points.length < 4) continue;

      try {
        const collider = new THREE.Mesh(new ConvexGeometry(points), material);
        collider.name = `Collider_convex_${group[0]?.name || index}`;
        collider.userData.isCollider = true;
        collider.renderOrder = 999;

        this.scene.add(collider);
        this.colliders.push(collider);
      } catch {
        // Nuvem degenerada (coplanar): ignora esta malha.
      }
    }

    return this.colliders.length;
  }

  clearColliders() {
    for (const collider of this.colliders) {
      this.scene.remove(collider);
      collider.geometry.dispose();
    }
    // O material é compartilhado: libera uma única vez.
    this.colliders[0]?.material.dispose();
    this.colliders = [];
  }

  /**
   * Exporta a definição dos colisores para consumo em Unity/Unreal/Three.js.
   */
  exportColliders() {
    return this.colliders.map((collider) => {
      const box = new THREE.Box3().setFromObject(collider);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const geometryType = collider.geometry.type;
      const type =
        geometryType === 'SphereGeometry'
          ? 'sphere'
          : geometryType === 'ConvexGeometry'
            ? 'convex'
            : 'box';

      return {
        name: collider.name,
        type,
        center: [center.x, center.y, center.z].map((n) => Number(n.toFixed(4))),
        size: [size.x, size.y, size.z].map((n) => Number(n.toFixed(4))),
      };
    });
  }

  // ── Materiais ──────────────────────────────────────────────────────────

  /** Lista de materiais únicos do modelo, para o painel da UI. */
  listMaterials() {
    return collectMaterials(this.currentModel);
  }

  /**
   * Aplica propriedades PBR. Sem alvo explícito, aplica ao objeto
   * selecionado; sem seleção, ao modelo inteiro.
   *
   * @param {Record<string, unknown>} properties
   * @param {THREE.Material|null} [target]
   */
  updateMaterial(properties, target = null) {
    if (target) {
      applyProperties([target], properties);

      return 1;
    }

    const root = this.selectedObject ?? this.currentModel;
    if (!root) return 0;

    /** @type {THREE.Material[]} */
    const materials = [];
    root.traverse((child) => {
      if (child.isMesh) materials.push(...materialsOf(child));
    });

    applyProperties([...new Set(materials)], properties);

    return materials.length;
  }

  /** @param {'shaded'|'wireframe'|'xray'} mode */
  setRenderMode(mode) {
    this.renderMode = mode;
    setRenderMode(this.currentModel, mode);
  }

  // ── Slicer ─────────────────────────────────────────────────────────────

  /**
   * F9 — os cortes agora são normalizados (0 a 1) sobre o bounding box,
   * então funcionam igual em um modelo de 2 m ou de 200 m.
   *
   * @param {boolean} enabled
   * @param {{x?: number, y?: number, z?: number}} [normalized] valores em [0,1]
   */
  setClipping(enabled, normalized = {}) {
    this.clippingEnabled = enabled;

    if (!this.currentModel) return;

    const box = new THREE.Box3().setFromObject(this.currentModel);
    if (box.isEmpty()) return;

    const { x = 1, y = 1, z = 1 } = normalized;

    // constant = distância do plano à origem, ao longo da normal (-1).
    this.clipPlanes.x.constant = THREE.MathUtils.lerp(box.min.x, box.max.x, clamp01(x));
    this.clipPlanes.y.constant = THREE.MathUtils.lerp(box.min.y, box.max.y, clamp01(y));
    this.clipPlanes.z.constant = THREE.MathUtils.lerp(box.min.z, box.max.z, clamp01(z));

    const planes = enabled ? [this.clipPlanes.x, this.clipPlanes.y, this.clipPlanes.z] : [];

    this.currentModel.traverse((child) => {
      if (!child.isMesh) return;

      for (const material of materialsOf(child)) {
        material.clippingPlanes = planes;
        material.clipShadows = true;
        material.needsUpdate = true;
      }
    });
  }

  // ── Estatísticas ───────────────────────────────────────────────────────

  /**
   * F8 — volume e área reais, calculados sobre a malha.
   *
   * @param {{unitInMeters?: number}} [options]
   */
  getStats(options = {}) {
    const empty = {
      vertices: 0,
      triangles: 0,
      meshes: 0,
      materials: 0,
      drawCalls: 0,
      size: { x: 0, y: 0, z: 0 },
      volumeCm3: null,
      surfaceAreaCm2: 0,
      watertight: false,
      boundaryEdges: 0,
    };

    if (!this.currentModel) return empty;

    const unitInMeters = options.unitInMeters ?? 1;

    let vertices = 0;
    let triangles = 0;
    let meshes = 0;
    let volume = 0;
    let area = 0;
    let boundaryEdges = 0;
    let allWatertight = true;

    const worldMatrix = new THREE.Matrix4();
    const temp = new THREE.Vector3();

    this.currentModel.updateMatrixWorld(true);

    this.currentModel.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;

      const geometry = child.geometry;
      const position = geometry.getAttribute('position');
      if (!position) return;

      meshes++;
      vertices += position.count;

      const index = geometry.getIndex();
      triangles += Math.floor((index ? index.count : position.count) / 3);

      // Transforma para espaço de mundo antes de medir, senão a escala
      // aplicada ao nó pai é ignorada.
      worldMatrix.copy(child.matrixWorld);
      const worldPositions = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        temp.fromBufferAttribute(position, i).applyMatrix4(worldMatrix);
        worldPositions[i * 3] = temp.x;
        worldPositions[i * 3 + 1] = temp.y;
        worldPositions[i * 3 + 2] = temp.z;
      }

      const indices = index ? index.array : null;

      volume += signedVolume(worldPositions, indices);
      area += surfaceArea(worldPositions, indices);

      const manifold = analyzeManifold(indices, worldPositions);
      if (!manifold.watertight) allWatertight = false;
      if (manifold.boundaryEdges > 0) boundaryEdges += manifold.boundaryEdges;
    });

    const box = new THREE.Box3().setFromObject(this.currentModel);
    const size = box.getSize(new THREE.Vector3());

    return {
      vertices,
      triangles,
      meshes,
      materials: this.listMaterials().length,
      drawCalls: this.renderer.info.render.calls,
      size: { x: size.x, y: size.y, z: size.z },
      // Volume só é reportado quando a malha é fechada — em vez de um
      // número inventado, a UI mostra "indisponível".
      volumeCm3: allWatertight ? Math.abs(volumeToCm3(volume, unitInMeters)) : null,
      surfaceAreaCm2: areaToCm2(area, unitInMeters),
      watertight: allWatertight,
      boundaryEdges,
    };
  }

  // ── Câmera ─────────────────────────────────────────────────────────────

  /** @param {'iso'|'top'|'front'|'side'|'back'} view */
  setViewPreset(view) {
    const target = this.orbit.target.clone();
    const distance = this.camera.position.distanceTo(target) || 20;

    const directions = {
      top: [0, 1, 0.0001],
      front: [0, 0, 1],
      back: [0, 0, -1],
      side: [1, 0, 0],
      iso: [1, 0.8, 1.2],
    };

    const dir = new THREE.Vector3(...(directions[view] ?? directions.iso)).normalize();
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.camera.lookAt(target);
    this.orbit.update();
  }

  setEnvironmentIntensity(value) {
    this.renderer.toneMappingExposure = THREE.MathUtils.clamp(value, 0, 3);
  }

  setLightIntensity(value) {
    this.dirLight.intensity = Math.max(0, value);
  }

  setGridVisible(visible) {
    this.grid.visible = visible;
    this.axes.visible = visible;
  }

  // ── Encerramento ───────────────────────────────────────────────────────

  /** Libera todos os recursos. Chame ao desmontar a aplicação. */
  dispose() {
    this.disposed = true;
    this.cancelAreaZoom();
    this.renderer.setAnimationLoop(null);
    this.resizeObserver?.disconnect();

    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.onVisibilityChange = null;
    }

    this.clearColliders();
    if (this.currentModel) {
      removeAndDispose(this.scene, this.currentModel);
      this.currentModel = null;
    }

    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.axes.geometry.dispose();
    this.axes.material.dispose();
    this.selectionBox.geometry.dispose();
    this.selectionBox.material.dispose();

    this.environmentTexture?.dispose();
    this.pmrem.dispose();
    this.orbit.dispose();
    this.gizmo.dispose();
    this.renderer.dispose();

    this.renderer.domElement.remove();
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}

/**
 * Amostra os vértices de um conjunto de malhas em espaço de mundo.
 * Malhas densas são subamostradas: o casco convexo de 500 mil pontos é
 * idêntico ao de 20 mil, mas leva minutos a mais.
 */
function collectPoints(meshes, maxPoints = 20000) {
  const total = meshes.reduce(
    (sum, mesh) => sum + (mesh.geometry?.getAttribute('position')?.count ?? 0),
    0
  );
  const step = Math.max(1, Math.ceil(total / maxPoints));

  const points = [];
  const temp = new THREE.Vector3();

  for (const mesh of meshes) {
    const position = mesh.geometry?.getAttribute('position');
    if (!position) continue;

    mesh.updateMatrixWorld(true);

    for (let i = 0; i < position.count; i += step) {
      temp.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      points.push(temp.clone());
    }
  }

  return points;
}

/** Compara dois estados de transform com tolerância de ponto flutuante. */
function sameTransform(a, b) {
  const equal = (x, y) => x.every((value, i) => Math.abs(value - y[i]) < 1e-6);

  return (
    equal(a.position, b.position) && equal(a.quaternion, b.quaternion) && equal(a.scale, b.scale)
  );
}
