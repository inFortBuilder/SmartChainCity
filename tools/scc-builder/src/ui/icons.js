/**
 * Ícones da interface.
 *
 * A8 da auditoria: a v1 carregava o Lucide inteiro de "unpkg.com/lucide@latest"
 * via <script> — CDN não fixada, quebra offline e sujeita a supply-chain.
 *
 * Importar o pacote todo do npm resolveria a CDN, mas arrastava ~700 KB
 * (o conjunto completo de ícones). Aqui importamos apenas os 33
 * ícones que a interface realmente usa, com tree-shaking.
 *
 * ATENÇÃO às chaves: o `createIcons` converte `data-lucide="arrow-right"`
 * para PascalCase e procura `icons.ArrowRight`. Um mapa com chaves em
 * kebab-case não é encontrado e todos os ícones somem silenciosamente
 * (só um warning no console).
 *
 * Ao adicionar um `data-lucide="novo-icone"` no HTML, importe-o aqui também.
 */

import { createIcons } from 'lucide';
import {
  AlignCenter,
  Archive,
  ArrowRight,
  BookOpen,
  Box,
  Boxes,
  Check,
  Crosshair,
  Download,
  Eraser,
  Expand,
  Eye,
  EyeOff,
  FileCheck,
  FileJson,
  Focus,
  FolderTree,
  Gamepad2,
  Grid,
  ImagePlus,
  Info,
  Keyboard,
  Layers,
  Layers2,
  Layers3,
  Map as MapIcon,
  Maximize2,
  MousePointer,
  Move,
  Package,
  Paintbrush,
  Palette,
  PanelLeft,
  PanelTop,
  Redo2,
  RefreshCw,
  RotateCw,
  Scale,
  ScanEye,
  ScanSearch,
  Scissors,
  Server,
  Shield,
  Split,
  Square,
  Trash2,
  Undo2,
  UploadCloud,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide';

/** Mapa consumido pelo createIcons — chaves em PascalCase. */
export const ICONS = {
  AlignCenter,
  Archive,
  ArrowRight,
  BookOpen,
  Box,
  Boxes,
  Check,
  Crosshair,
  Download,
  Eraser,
  Expand,
  Eye,
  EyeOff,
  FileCheck,
  FileJson,
  Focus,
  FolderTree,
  Gamepad2,
  Grid,
  ImagePlus,
  Info,
  Keyboard,
  Layers,
  Layers2,
  Layers3,
  Map: MapIcon,
  Maximize2,
  MousePointer,
  Move,
  Package,
  Paintbrush,
  Palette,
  PanelLeft,
  PanelTop,
  Redo2,
  RefreshCw,
  RotateCw,
  Scale,
  ScanEye,
  ScanSearch,
  Scissors,
  Server,
  Shield,
  Split,
  Square,
  Trash2,
  Undo2,
  UploadCloud,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
};

export function renderIcons(root = document) {
  try {
    createIcons({ icons: ICONS, nameAttr: 'data-lucide', root });
  } catch (error) {
    // Ícone ausente nunca deve derrubar a aplicação.
    console.warn('[SCC Builder] Falha ao renderizar ícones:', error);
  }
}
