// Locais de trabalho na rua (fase 4 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md).
//
// O turno do game-core não tem lugar: o avatar trabalha pelo painel (POST /v1/avatars/:id/work). Para o GPS
// ter o trabalho como destino, as 44 profissões se dividem em 12 setores, e cada setor tem um prédio na rua,
// com a mesma casca da loja do jogo e da farmácia (mercado-rua.js): paredes, porta, letreiro e um balcão.
//
// - Os lugares saíram de uma busca no street view, perto das lojas: a frente do prédio fica atrás da calçada
//   (meia largura da rua + 3,2 m da linha do meio), virada para a rua, com o prédio inteiro (12 × 10 m, mais
//   1 m de folga) fora das ruas, a pelo menos 35 m dos outros e das lojas, a até 450 m da loja do jogo.
// - Os prédios não ocupam lotes do jogo (que estão à venda): ficam na beira da calçada, como as lojas.
// - O GPS (minimapa.js) ganha "Trabalho" com o setor da profissão do avatar. Dentro do prédio do próprio
//   trabalho, o aviso diz que o turno é pelo painel; nos outros, para quem é aquele trabalho.
// - Só a cena: o turno, o pagamento e o deslocamento seguem do jeito que são.
//
// PREMISSAS: os 12 setores e quem fica em cada um, os lugares em Pittsburg e o tamanho (12 × 10 m).

import { storeShell } from './mercado-rua.js';

const CURB = 0.15;

/** Setores de trabalho: as profissões (códigos do catálogo do game-core) e o letreiro. */
export const SECTORS = {
  padaria: { label: 'Padaria e Cozinha', sign: 'PADARIA', color: 0xc77d2e, jobs: ['padeiro', 'confeiteiro', 'cozinheiro', 'chef', 'garcom'] },
  saude: { label: 'Hospital', sign: 'HOSPITAL', color: 0xd94848, jobs: ['enfermeira', 'dentista', 'farmaceutico', 'medico'] },
  escola: { label: 'Escola', sign: 'ESCOLA', color: 0x3a7bd5, jobs: ['professor', 'orientador_escolar', 'coordenador_escolar', 'diretor'] },
  seguranca: { label: 'Delegacia e Bombeiros', sign: 'DELEGACIA', color: 0x2c3e66, jobs: ['bombeiro', 'policial', 'perito', 'delegado'] },
  obras: { label: 'Construtora', sign: 'CONSTRUTORA', color: 0xd4a017, jobs: ['pedreiro', 'construtor', 'arquiteto', 'engenheiro_civil', 'incorporador'] },
  imoveis: { label: 'Imobiliária', sign: 'IMOBILIÁRIA', color: 0x4f8a5b, jobs: ['corretor_imoveis', 'consultor_imoveis', 'administrador_condominio'] },
  pet: { label: 'Clínica Pet', sign: 'CLÍNICA PET', color: 0x8e5ea2, jobs: ['tosador', 'pet_sitter', 'adestrador', 'veterinario'] },
  moda: { label: 'Ateliê de Moda', sign: 'ATELIÊ', color: 0xb03a74, jobs: ['alfaiate', 'modelista', 'designer_acessorios', 'estilista'] },
  campo: { label: 'Cooperativa do Campo', sign: 'COOPERATIVA', color: 0x6b8e23, jobs: ['agricultor', 'pescador', 'fazendeiro', 'agronomo'] },
  transporte: { label: 'Garagem de Transportes', sign: 'GARAGEM', color: 0x5d6d7e, jobs: ['motorista', 'mecanico'] },
  hotel: { label: 'Hotel', sign: 'HOTEL', color: 0x1f6f8b, jobs: ['recepcionista', 'concierge', 'hoteleiro'] },
  aeroporto: { label: 'Escritório da Aviação', sign: 'AVIAÇÃO', color: 0x34495e, jobs: ['piloto', 'astronauta'] },
};

/** O setor da profissão (código do catálogo), ou null. */
export const sectorOf = (jobCode) => Object.keys(SECTORS).find((k) => SECTORS[k].jobs.includes(jobCode)) ?? null;

/** Onde fica cada setor: a frente (meio da porta, atrás da calçada) e o rumo para dentro. */
export const WORKPLACES = {
  pittsburg: {
    padaria: { front: [-1430.9, 4811.3], yaw: -1.171 },
    saude: { front: [-1364.1, 4919.9], yaw: 2.003 },
    escola: { front: [-1336.0, 4819.7], yaw: -1.186 },
    seguranca: { front: [-1477.0, 4853.9], yaw: -2.753 },
    obras: { front: [-1351.8, 4780.8], yaw: -1.186 },
    imoveis: { front: [-1311.2, 4880.9], yaw: -1.186 },
    pet: { front: [-1299.7, 4824.6], yaw: 2.014 },
    moda: { front: [-1433.7, 4761.2], yaw: 1.849 },
    campo: { front: [-1349.0, 4952.6], yaw: 2.003 },
    transporte: { front: [-1315.0, 4788.2], yaw: 1.931 },
    hotel: { front: [-1502.1, 4883.9], yaw: 0.526 },
    aeroporto: { front: [-1284.2, 4857.1], yaw: 2.014 },
  },
};

export function createWorkplaces({ THREE, scene, city, groundY, servidor, streetView }) {
  const spots = WORKPLACES[city];
  if (!spots) return null;
  const style = document.createElement('style');
  style.textContent = `
    .tb-prompt { position: fixed; left: 50%; bottom: 110px; transform: translateX(-50%); z-index: 8; padding: 9px 16px; border-radius: 999px;
      background: rgba(15,23,42,.9); color: #fff; font: 600 14px system-ui, sans-serif; max-width: calc(100vw - 32px); text-align: center; }
    .tb-prompt[hidden] { display: none; }
    @media (max-width: 640px) { .tb-prompt { bottom: 440px; } }
  `;
  document.head.append(style);
  const prompt = document.createElement('div');
  prompt.className = 'tb-prompt';
  prompt.hidden = true;
  document.body.append(prompt);

  const counter = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const built = Object.entries(spots).map(([id, at]) => {
    const sector = SECTORS[id];
    const spec = { id, front: at.front, yaw: at.yaw, width: 12, depth: 10 };
    const shell = storeShell(THREE, scene, spec, groundY + CURB, { name: `trabalho-${id}`, sign: sector.sign, color: sector.color });
    // Balcão no fundo: o lugar de trabalho.
    shell.box(6, 1.0, 0.8, 0, 0.5, 7.5, counter);
    const solid = [{ x0: -3.4, x1: 3.4, z0: 7.0, z1: 8.0 }];
    return { id, sector, spec, shell, walkable: shell.walkableWith(solid) };
  });

  const myJob = () => servidor.getData?.()?.avatar?.job ?? null;
  let inside = null;

  function update() {
    if (!streetView.active()) {
      prompt.hidden = true;
      inside = null;
      return;
    }
    const p = streetView.position();
    const here = built.find((b) => b.shell.inside(p.x, p.z)) ?? null;
    if (here === inside) return;
    inside = here;
    if (!here) {
      prompt.hidden = true;
      return;
    }
    const job = myJob();
    const mine = job && sectorOf(job.code) === here.id;
    prompt.textContent = mine
      ? `${here.sector.label}: o seu trabalho (${job.label}). O turno é pelo painel, em Trabalhar.`
      : `${here.sector.label}: trabalho de ${here.sector.jobs.length} profissões.`;
    prompt.hidden = false;
  }

  return {
    groups: built.map((b) => b.shell.group),
    walkable: (x, z) => built.some((b) => b.walkable(x, z)),
    floorAt: (x, z) => (built.some((b) => b.walkable(x, z)) ? groundY + CURB : null),
    update,
    /** O destino do GPS: o prédio do setor da profissão do avatar (a porta), ou null. */
    myPlace: () => {
      const job = myJob();
      const b = job && built.find((w) => w.id === sectorOf(job.code));
      if (!b) return null;
      const [x, z] = b.shell.toWorld(0, -1);
      return { id: 'trabalho', label: `Trabalho: ${b.sector.label}`, x, z };
    },
    debug: () => ({ count: built.length, inside: inside?.id ?? null, places: built.map((b) => ({ id: b.id, door: b.shell.toWorld(0, -1) })) }),
  };
}
