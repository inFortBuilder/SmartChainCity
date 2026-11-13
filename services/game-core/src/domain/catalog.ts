/**
 * Raridades e profissões do GDD (doc 02 §2.2 e §3). Fica no código até o
 * catálogo do Strapi (E1.2) assumir; o código de cada profissão é o que o
 * Strapi vai usar como chave.
 */
export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export const PROFESSIONS: Record<Rarity, Record<string, string>> = {
  common: {
    pedreiro: 'Pedreiro',
    alfaiate: 'Alfaiate',
    padeiro: 'Padeiro',
    agricultor: 'Agricultor',
    enfermeira: 'Enfermeira',
    professor: 'Professor',
    bombeiro: 'Bombeiro',
    motorista: 'Motorista',
    tosador: 'Tosador',
    corretor_imoveis: 'Corretor de Imóveis',
    recepcionista: 'Recepcionista',
  },
  rare: {
    construtor: 'Construtor',
    modelista: 'Modelista',
    confeiteiro: 'Confeiteiro',
    pescador: 'Pescador',
    dentista: 'Dentista',
    orientador_escolar: 'Orientador Escolar',
    policial: 'Policial',
    mecanico: 'Mecânico',
    pet_sitter: 'Pet Sitter',
    consultor_imoveis: 'Consultor de Imóveis',
    garcom: 'Garçom',
  },
  epic: {
    arquiteto: 'Arquiteto',
    designer_acessorios: 'Designer de Acessórios',
    cozinheiro: 'Cozinheiro',
    fazendeiro: 'Fazendeiro',
    farmaceutico: 'Farmacêutico',
    coordenador_escolar: 'Coordenador Escolar',
    perito: 'Perito',
    piloto: 'Piloto',
    adestrador: 'Adestrador',
    administrador_condominio: 'Administrador de Condomínio',
    concierge: 'Concierge',
    veterinario: 'Veterinário',
    incorporador: 'Incorporador',
    hoteleiro: 'Hoteleiro',
  },
  legendary: {
    engenheiro_civil: 'Engenheiro Civil',
    estilista: 'Estilista',
    chef: 'Chef',
    agronomo: 'Agrônomo',
    medico: 'Médico',
    diretor: 'Diretor',
    delegado: 'Delegado',
    astronauta: 'Astronauta',
  },
};

export const isRarity = (value: string): value is Rarity => (RARITIES as readonly string[]).includes(value);

/** A profissão precisa ser da raridade do avatar (a profissão inicial sai da mesma raridade). */
export const professionFits = (rarity: Rarity, jobCode: string) => jobCode in PROFESSIONS[rarity];

export const professionLabel = (rarity: Rarity, jobCode: string) => PROFESSIONS[rarity][jobCode] ?? jobCode;
