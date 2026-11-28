// Consumir em casa (fase 2 do mundo aberto, docs/desenvolvimento/mundo-aberto-terceira-pessoa.md): no
// interior da residência do jogador (escritorio.html?tipo=home&dono=1), a geladeira, o fogão, a cama e o
// banheiro chamam as rotas do game-core que já existem:
//
// - geladeira: come um alimento da despensa (POST /v1/avatars/:id/consume);
// - fogão: cozinha um alimento da despensa (POST /v1/avatars/:id/cook), com fogão ou micro-ondas;
// - cama: dorme 8 h ou cochila 4 h (POST /v1/avatars/:id/rest);
// - banheiro: banho, ducha, dentes e mãos (POST /v1/avatars/:id/chores).
//
// A regra é a do servidor (moradia regular, despensa, descanso obrigatório, intervalo da higiene); aqui só
// sai o aviso. Usa a mesma sessão do mapa (sessionStorage), e o alimento é o que há mais na despensa.

const params = new URLSearchParams(location.search);
const GAME = params.get('game') ?? 'http://127.0.0.1:8020';

const ERROS = {
  not_in_pantry: 'A despensa está vazia: compre no mercado.',
  not_hungry: 'O avatar está satisfeito.',
  no_stove: 'Sem fogão nem micro-ondas: compre na loja do jogo.',
  no_home: 'Sem moradia regular: alugue, vá para o hotel ou regularize a casa.',
  not_tired: 'O avatar está com a energia cheia.',
  resting: 'O avatar já está dormindo.',
  shift_running: 'O avatar está trabalhando.',
  chore_cooldown: 'Já fez isso há pouco: de novo daqui a algumas horas.',
  in_hospital: 'O avatar está internado.',
};

export function createCasaJogo() {
  let session = null;
  try {
    session = JSON.parse(sessionStorage.getItem('scc-servidor-token') ?? 'null');
  } catch {
    session = null;
  }
  let avatar = null;
  let foods = [];

  const call = async (path, { method = 'GET', body } = {}) => {
    const r = await fetch(GAME + path, {
      method,
      headers: { 'content-type': 'application/json', ...(session?.token ? { authorization: `Bearer ${session.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(json.error?.message ?? `Erro ${r.status}`), { code: json.error?.code });
    return json;
  };
  const label = (code) => foods.find((f) => f.code === code)?.label ?? code;
  /** O alimento com mais unidades na despensa. */
  const pick = () => [...(avatar?.pantry ?? [])].sort((a, b) => b.units - a.units)[0]?.food ?? null;
  const fail = (e) => ERROS[e.code] ?? e.message;
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return {
    /** Carrega o avatar da sessão e o catálogo. Sem sessão, a casa fica só de enfeite. */
    async load() {
      if (!session?.token) return false;
      try {
        const [list, cat] = await Promise.all([call('/v1/avatars'), call('/v1/catalog/foods').catch(() => ({ foods: [] }))]);
        avatar = list.avatars?.[0] ?? null;
        foods = cat.foods ?? [];
      } catch {
        avatar = null;
      }
      return !!avatar;
    },
    ready: () => !!avatar,
    async eat() {
      const food = pick();
      if (!food) return ERROS.not_in_pantry;
      try {
        avatar = (await call(`/v1/avatars/${avatar.id}/consume`, { method: 'POST', body: { food } })).avatar;
        return `${label(food)} da geladeira: alimentação ${avatar.attributes.food}/10.`;
      } catch (e) {
        return fail(e);
      }
    },
    async cook() {
      const food = pick();
      if (!food) return ERROS.not_in_pantry;
      try {
        avatar = (await call(`/v1/avatars/${avatar.id}/cook`, { method: 'POST', body: { food } })).avatar;
        return `${label(food)} feito em casa: alimentação ${avatar.attributes.food}/10, saúde ${avatar.attributes.health}/10.`;
      } catch (e) {
        return fail(e);
      }
    },
    async sleep(hours) {
      try {
        const r = await call(`/v1/avatars/${avatar.id}/rest`, { method: 'POST', body: { hours } });
        avatar = r.avatar;
        return `Dormindo ${hours} h: acorda às ${hora(r.avatar.rest.ends_at)} com +${r.avatar.rest.energy} de energia${r.housed ? '' : ' (sem moradia regular, metade)'}.`;
      } catch (e) {
        return fail(e);
      }
    },
    async chore(code, nome) {
      try {
        avatar = (await call(`/v1/avatars/${avatar.id}/chores`, { method: 'POST', body: { code } })).avatar;
        return `${nome}: higiene ${avatar.attributes.hygiene}/10.`;
      } catch (e) {
        return fail(e);
      }
    },
    /** Para testes: o avatar como o servidor devolveu por último. */
    avatar: () => avatar,
  };
}
