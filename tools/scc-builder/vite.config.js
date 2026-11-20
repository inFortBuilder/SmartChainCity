import { fileURLToPath } from 'node:url';

import { defineConfig, loadEnv } from 'vite';

// O .env é o desta pasta, de onde quer que o Vite seja chamado.
const raiz = fileURLToPath(new URL('.', import.meta.url));

/**
 * SCC Builder - configuração do bundler.
 *
 * A base pública deixa de ser fixa em "/scc-builder/" e passa a vir de
 * VITE_BASE_PATH, permitindo publicar em qualquer subdiretório ou na raiz.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, raiz, '');
  const base = env.VITE_BASE_PATH || '/scc-builder/';

  return {
    root: raiz,
    envDir: raiz,
    base,
    server: {
      port: Number(env.VITE_DEV_PORT || 5173),
      open: env.VITE_OPEN !== 'false',
      cors: true,
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      target: 'es2020',
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          // Separa o núcleo do Three.js dos loaders: os loaders pesados
          // (FBX/DAE) só entram no bundle sob demanda via import() dinâmico.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('three/examples/jsm/loaders')) return 'three-loaders';
            if (id.includes('three/examples/jsm/exporters')) return 'three-exporters';
            if (id.includes('three')) return 'three-core';
            if (id.includes('jszip')) return 'jszip';
            // Só o "Exportar para o mapa" usa: sem chunk manual, o Rollup o deixa
            // num pedaço que só carrega no clique (chunk manual criava import estático).
            if (/@gltf-transform|meshoptimizer|ndarray|property-graph|gl-matrix/.test(id)) {
              return undefined; // o Rollup separa pelo import() dinâmico
            }
            return 'vendor';
          },
        },
      },
    },
    optimizeDeps: {
      // Os loaders entram por import() dinâmico. Fora desta lista, o Vite só os
      // descobre no primeiro uso, reotimiza as dependências e troca o ?v= dos
      // arquivos: a página aberta falha com "Failed to fetch dynamically imported
      // module" (ex.: ao importar o primeiro .fbx). Pré-empacotados, o hash não muda.
      include: [
        'three',
        'three/examples/jsm/loaders/GLTFLoader.js',
        'three/examples/jsm/loaders/OBJLoader.js',
        'three/examples/jsm/loaders/MTLLoader.js',
        'three/examples/jsm/loaders/FBXLoader.js',
        'three/examples/jsm/loaders/ColladaLoader.js',
        'three/examples/jsm/loaders/STLLoader.js',
        'three/examples/jsm/loaders/PLYLoader.js',
        'three/examples/jsm/loaders/DRACOLoader.js',
        'three/examples/jsm/loaders/KTX2Loader.js',
        'three/examples/jsm/exporters/GLTFExporter.js',
        'three/examples/jsm/exporters/OBJExporter.js',
        'three/examples/jsm/exporters/PLYExporter.js',
        'three/examples/jsm/exporters/STLExporter.js',
      ],
    },
  };
});
