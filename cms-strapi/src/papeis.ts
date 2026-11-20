import type { Core } from '@strapi/strapi';

/**
 * Papéis do admin (trilha do CMS, passo 7). Ficam no código, não na tela:
 * a cada início o Strapi cria o que falta e reaplica as permissões, então uma
 * mudança feita à mão em Configurações → Papéis volta ao que está aqui.
 *
 * - game designer: edita tudo do catálogo (balanceamento), cria e publica; não apaga,
 *   porque o jogo guarda códigos (profissão do avatar, tipo do imóvel).
 * - conteúdo: edita só os textos (nomes e descrições) e sobe arte na biblioteca;
 *   não publica: o game designer revisa e publica.
 * - leitura: só vê.
 */

const CM = 'plugin::content-manager.explorer';

/** Campos de texto de cada tipo: o que o papel "conteúdo" pode editar. */
export const TEXT_FIELDS: Record<string, string[]> = {
  'api::job.job': ['label', 'tasks.name'],
  'api::activity.activity': ['label'],
  'api::food.food': ['label'],
  'api::rarity.rarity': ['label'],
  'api::attribute-multiplier.attribute-multiplier': [],
  'api::property-type.property-type': ['label', 'description'],
};

export const CATALOG_TYPES = Object.keys(TEXT_FIELDS);

type Action = 'read' | 'create' | 'update' | 'delete' | 'publish';

interface RoleSpec {
  code: string;
  name: string;
  description: string;
  /** Por ação: 'all' (todos os campos), uma lista de campos, ou ausente (sem permissão). */
  content: Partial<Record<Action, 'all' | 'text'>>;
  /** Biblioteca de mídia. */
  media: string[];
}

export const ROLES: RoleSpec[] = [
  {
    code: 'scc-game-designer',
    name: 'Game designer',
    description: 'Edita o balanceamento do catálogo, cria e publica. Não apaga.',
    content: { read: 'all', create: 'all', update: 'all', publish: 'all' },
    media: ['read', 'assets.create', 'assets.update', 'assets.download', 'assets.copy-link'],
  },
  {
    code: 'scc-conteudo',
    name: 'Conteúdo',
    description: 'Edita textos (nomes e descrições) e sobe arte. Não publica.',
    content: { read: 'all', update: 'text' },
    media: ['read', 'assets.create', 'assets.update', 'assets.download', 'assets.copy-link'],
  },
  {
    code: 'scc-leitura',
    name: 'Leitura',
    description: 'Só vê o catálogo.',
    content: { read: 'all' },
    media: ['read', 'assets.download'],
  },
];

/** Todos os campos de um tipo, com os de componente como `tasks.name`. */
export function allFields(strapi: Core.Strapi, uid: string): string[] {
  const walk = (attributes: Record<string, { type: string; component?: string }>, prefix: string): string[] =>
    Object.entries(attributes).flatMap(([name, attr]) => {
      if (attr.type === 'component' && attr.component) {
        return walk(strapi.components[attr.component as keyof typeof strapi.components].attributes as never, `${prefix}${name}.`);
      }
      return [`${prefix}${name}`];
    });
  const ct = strapi.contentTypes[uid as keyof typeof strapi.contentTypes];
  // Campos de sistema (datas, autor, documentId) o Strapi cuida sozinho.
  const own = Object.fromEntries(
    Object.entries(ct.attributes).filter(
      ([name, attr]) =>
        !['createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'locale', 'localizations'].includes(name) &&
        (attr as { type: string }).type !== 'relation',
    ),
  );
  return walk(own as never, '');
}

export function permissionsFor(strapi: Core.Strapi, spec: RoleSpec) {
  const content = CATALOG_TYPES.flatMap((uid) =>
    (Object.entries(spec.content) as [Action, 'all' | 'text'][]).flatMap(([action, scope]) => {
      if (action === 'publish' || action === 'delete') return [{ action: `${CM}.${action}`, subject: uid, properties: {}, conditions: [] }];
      const fields = scope === 'all' ? allFields(strapi, uid) : TEXT_FIELDS[uid]!;
      // Sem campo de texto (multiplicadores), o papel "conteúdo" nem recebe a ação.
      if (!fields.length) return [];
      return [{ action: `${CM}.${action}`, subject: uid, properties: { fields }, conditions: [] }];
    }),
  );
  const media = spec.media.map((a) => ({ action: `plugin::upload.${a}`, subject: null, properties: {}, conditions: [] }));
  return [...content, ...media];
}

/** Cria os papéis que faltam e reaplica as permissões de todos. */
export async function syncRoles(strapi: Core.Strapi) {
  const roles = strapi.service('admin::role');
  for (const spec of ROLES) {
    let role = await roles.findOne({ code: spec.code });
    if (!role) role = await roles.create({ code: spec.code, name: spec.name, description: spec.description });
    else await roles.update({ id: role.id }, { name: spec.name, description: spec.description });
    await roles.assignPermissions(role.id, permissionsFor(strapi, spec));
  }
  strapi.log.info(`Papéis do admin: ${ROLES.map((r) => r.name).join(', ')}`);
}
