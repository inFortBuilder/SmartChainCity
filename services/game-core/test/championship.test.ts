import { createHash, randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { newAvatar } from '../src/domain/avatar.js';
import {
  type Championship,
  type ChampionshipPayer,
  type ChampionshipResult,
  type ChampionshipStore,
  ENTRY_CENTS,
  type Member,
  type Team,
  endOfMonth,
  monthOf,
  newChampionship,
  play,
} from '../src/domain/championship.js';
import { PostgresChampionshipStore } from '../src/infra/db/postgres-championship-store.js';
import { EconomyPayer } from '../src/infra/economy-payer.js';
import { MemoryAvatarStore } from '../src/infra/memory-store.js';
import { MemoryChampionshipStore } from '../src/infra/memory-championship-store.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const INTERNAL = 'chave-interna-de-teste-com-mais-de-32-caracteres'; // gitleaks:allow (só no teste)
const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET, INTERNAL_TOKEN: INTERNAL });
const t0 = new Date('2026-11-21T08:00:00Z');
const SEED = 'ab'.repeat(32);

const team = (championshipId: string, name: string): Team => ({ id: randomUUID(), championshipId, name, captainAccountId: randomUUID(), createdAt: t0 });
const member = (t: Team, over: Partial<Member> = {}): Member => ({
  championshipId: t.championshipId,
  teamId: t.id,
  accountId: randomUUID(),
  avatarId: randomUUID(),
  feeCents: ENTRY_CENTS,
  status: 'paid',
  joinedAt: t0,
  ...over,
});
const code = async (p: Promise<unknown>) => p.then(() => null, (e) => (e as { code?: string }).code);

describe('disputa', () => {
  const full = (t: Team) => Array.from({ length: 6 }, () => member(t));

  it('mês, prazo e o compromisso da semente', () => {
    expect(monthOf(t0)).toBe('2026-11');
    expect(endOfMonth('2026-11')).toEqual(new Date('2026-12-01T00:00:00Z'));
    expect(endOfMonth('2026-12')).toEqual(new Date('2027-01-01T00:00:00Z'));
    const c = newChampionship('2026-11', SEED);
    expect(c.seedCommit).toBe(createHash('sha256').update(SEED).digest('hex'));
  });

  it('3 times completos: 75% em 50/35/15 para os 6 de cada um; 25% e os centavos para a queima', () => {
    const teams = ['A', 'B', 'C'].map((n) => team('2026-11', n));
    const members = teams.flatMap(full);
    // O time A tem atributos cheios; os outros, zerados: com 60% de força, A ganha.
    const strong = new Set(members.filter((m) => m.teamId === teams[0]!.id).map((m) => m.avatarId));
    const r = play({ seed: SEED }, teams, members, (id) => (strong.has(id) ? { energy: 10, health: 10, happiness: 10 } : { energy: 0, health: 0, happiness: 0 }));
    expect(r.played).toBe(true);
    expect(r.poolCents).toBe('18000');
    expect(r.ranking[0]).toMatchObject({ name: 'A', strength: 1, complete: true });
    // 18.000 × 75% = 13.500 → 6.750 / 4.725 / 2.025 por time → 1.125 / 787 / 337 por jogador.
    const per = (t: Team) => r.payouts.filter((p) => members.find((m) => m.accountId === p.accountId)!.teamId === t.id).map((p) => p.cents);
    const first = teams.find((t) => t.name === r.ranking[0]!.name)!;
    const second = teams.find((t) => t.name === r.ranking[1]!.name)!;
    const third = teams.find((t) => t.name === r.ranking[2]!.name)!;
    expect(per(first)).toEqual(Array(6).fill('1125'));
    expect(per(second)).toEqual(Array(6).fill('787'));
    expect(per(third)).toEqual(Array(6).fill('337'));
    const paid = r.payouts.reduce((s, p) => s + BigInt(p.cents), 0n);
    expect(paid + BigInt(r.burnCents)).toBe(18_000n);
    expect(BigInt(r.burnCents)).toBeGreaterThanOrEqual(4500n);
    // A mesma semente refaz a mesma classificação.
    expect(play({ seed: SEED }, teams, members, () => ({ energy: 5, health: 5, happiness: 5 })).ranking.map((x) => x.teamId)).toEqual(
      play({ seed: SEED }, teams, members, () => ({ energy: 5, health: 5, happiness: 5 })).ranking.map((x) => x.teamId),
    );
  });

  it('time incompleto não joga e recebe de volta; com menos de 3 completos, todos de volta e nada queimado', () => {
    const teams = ['A', 'B', 'C', 'D'].map((n) => team('2026-11', n));
    const members = [...teams.slice(0, 3).flatMap(full), member(teams[3]!), member(teams[3]!, { status: 'pending' })];
    const r = play({ seed: SEED }, teams, members, () => ({ energy: 5, health: 5, happiness: 5 }));
    expect(r.ranking.at(-1)).toMatchObject({ name: 'D', complete: false });
    const d = r.payouts.filter((p) => p.reason === 'refund');
    expect(d).toHaveLength(1);
    expect(d[0]!.cents).toBe('1000');
    expect(r.poolCents).toBe('19000');

    const few = play({ seed: SEED }, teams.slice(0, 2), teams.slice(0, 2).flatMap(full), () => null);
    expect(few).toMatchObject({ played: false, burnCents: '0', poolCents: '12000' });
    expect(few.payouts.every((p) => p.reason === 'refund' && p.cents === '1000')).toBe(true);
  });

  it('o ledger: inscrição para o escrow do mês; disputa sai do escrow para os jogadores e a queima', async () => {
    const bodies: { kind: string; legs: { owner_type: string; owner_id: string; amount: string }[] }[] = [];
    const keys: string[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      keys.push(new Headers(init.headers).get('idempotency-key')!);
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    const payer = new EconomyPayer('http://economy', 'token', fetchFn);
    const t = team('2026-11', 'A');
    const m = member(t);
    await payer.chargeEntry(m);
    expect(bodies[0]).toMatchObject({
      kind: 'championship_entry',
      legs: [
        { owner_type: 'player', owner_id: m.accountId, amount: '-1000' },
        { owner_type: 'escrow', owner_id: 'championship-2026-11', amount: '1000' },
      ],
    });
    expect(keys[0]).toBe(`championship-entry:2026-11:${m.accountId}`);
    const result: ChampionshipResult = {
      played: true,
      ranking: [],
      payouts: [
        { accountId: 'a', cents: '700', reason: 'prize' },
        { accountId: 'b', cents: '50', reason: 'refund' },
      ],
      burnCents: '250',
      poolCents: '1000',
    };
    await payer.payOut(newChampionship('2026-11', SEED), result);
    expect(bodies[1]).toMatchObject({
      kind: 'championship_payout',
      legs: [
        { owner_type: 'escrow', owner_id: 'championship-2026-11', amount: '-1000' },
        { owner_id: 'a', amount: '700' },
        { owner_id: 'b', amount: '50' },
        { owner_type: 'burn', owner_id: 'championship', amount: '250' },
      ],
    });
    expect(keys[1]).toBe('championship-payout:2026-11');
    await payer.payOut(newChampionship('2026-10', SEED), { ...result, poolCents: '0', payouts: [], burnCents: '0' });
    expect(bodies).toHaveLength(2);
  });
});

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
afterAll(() => pool?.end());

describe.each([
  ['memória', () => new MemoryChampionshipStore(), true],
  ['postgres', () => new PostgresChampionshipStore(pool!), pool !== null],
] as [string, () => ChampionshipStore, boolean][])('store do campeonato (%s)', (_name, make, enabled) => {
  // No Postgres compartilhado, cada teste usa um mês próprio.
  const month = () => `${2100 + Math.floor(Math.random() * 7000)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`;

  it.skipIf(!enabled)('uma semente por mês, nome único sem diferença de maiúsculas, um time por conta, 6 por time', async () => {
    const s = make();
    const m = month();
    const c = await s.getOrCreate(m);
    expect((await s.getOrCreate(m)).seed).toBe(c.seed);
    expect(c).toMatchObject({ status: 'open', endsAt: endOfMonth(m), result: null });

    const a = team(m, 'Os Botões');
    const captain = member(a, { status: 'pending' });
    await s.createTeam(a, captain);
    expect(await code(s.createTeam(team(m, 'os botões'), member(team(m, 'x'))))).toBe('team_name_taken');
    expect(await code(s.createTeam(team(m, 'Outro'), member(a, { accountId: captain.accountId })))).toBe('already_registered');
    for (let i = 0; i < 5; i++) await s.addMember(member(a));
    expect(await code(s.addMember(member(a)))).toBe('team_full');
    expect(await code(s.addMember(member(team(m, 'fantasma'))))).toBe('not_found');
    expect((await s.members(m)).filter((x) => x.teamId === a.id)).toHaveLength(6);
    expect((await s.pendingMembers(new Date(t0.getTime() + 1))).some((x) => x.accountId === captain.accountId)).toBe(true);
    await s.markPaid(m, captain.accountId);
    expect((await s.members(m)).find((x) => x.accountId === captain.accountId)!.status).toBe('paid');
  });

  it.skipIf(!enabled)('quem não pagou sai, e o time vazio some; disputa só uma vez', async () => {
    const s = make();
    const m = month();
    await s.getOrCreate(m);
    const a = team(m, 'Solitários');
    const only = member(a, { status: 'pending' });
    await s.createTeam(a, only);
    await s.dropPending(m, only.accountId);
    expect(await s.teams(m)).toEqual([]);
    // O nome volta a ficar livre.
    const again = team(m, 'Solitários');
    await s.createTeam(again, member(again));

    const due = await s.due(endOfMonth(m));
    expect(due.map((c: Championship) => c.id)).toContain(m);
    const result: ChampionshipResult = { played: false, ranking: [], payouts: [], burnCents: '0', poolCents: '0' };
    expect(await s.settle(m, result, endOfMonth(m))).toBe(true);
    expect(await s.settle(m, result, endOfMonth(m))).toBe(false);
    expect((await s.get(m))!).toMatchObject({ status: 'settled', result });
  });
});

class FakePayer implements ChampionshipPayer {
  balances = new Map<string, bigint>();
  escrow = 0n;
  burned = 0n;
  async chargeEntry(m: Member) {
    const b = this.balances.get(m.accountId) ?? 0n;
    if (b < m.feeCents) throw new AppError('insufficient_thaler', 'THALER insuficiente.', 409);
    this.balances.set(m.accountId, b - m.feeCents);
    this.escrow += m.feeCents;
  }
  async payOut(_c: Championship, r: ChampionshipResult) {
    for (const p of r.payouts) this.balances.set(p.accountId, (this.balances.get(p.accountId) ?? 0n) + BigInt(p.cents));
    this.burned += BigInt(r.burnCents);
    this.escrow -= BigInt(r.poolCents);
  }
}

describe('API do campeonato', () => {
  let avatars: MemoryAvatarStore;
  let payer: FakePayer;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    avatars = new MemoryAvatarStore();
    payer = new FakePayer();
    clock = t0;
    app = await buildApp(config, avatars, () => clock, null, null, null, () => 0.5, null, null, {
      store: new MemoryChampionshipStore(),
      payer,
    });
  });

  const auth = async (accountId: string) => ({
    authorization: `Bearer ${await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId)
      .setIssuer('scc-gateway')
      .setAudience('scc-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET))}`,
  });
  const player = async (thaler = 5000n) => {
    const a = await avatars.create(newAvatar({ id: randomUUID(), accountId: randomUUID(), rarity: 'common', jobCode: 'padeiro' }, t0));
    payer.balances.set(a.accountId, thaler);
    return { a, h: await auth(a.accountId) };
  };

  it('cria times, entra, recusa time cheio e sem THALER; na virada do mês disputa e paga', async () => {
    const teams: string[] = [];
    for (const name of ['Azul', 'Verde', 'Branco']) {
      const { a, h } = await player();
      const r = await app.inject({ method: 'POST', url: '/v1/championships/current/teams', headers: h, payload: { name, avatar_id: a.id } });
      expect(r.statusCode).toBe(201);
      expect(r.json().championship.me).toMatchObject({ status: 'paid' });
      teams.push(r.json().championship.teams.find((t: { mine: boolean }) => t.mine).id);
      for (let i = 0; i < 5; i++) {
        const p = await player();
        const j = await app.inject({ method: 'POST', url: `/v1/championships/current/teams/${teams.at(-1)}/members`, headers: p.h, payload: { avatar_id: p.a.id } });
        expect(j.statusCode).toBe(201);
      }
    }
    const extra = await player();
    const full = await app.inject({ method: 'POST', url: `/v1/championships/current/teams/${teams[0]}/members`, headers: extra.h, payload: { avatar_id: extra.a.id } });
    expect(full.json().error.code).toBe('team_full');
    const broke = await player(0n);
    const nope = await app.inject({ method: 'POST', url: '/v1/championships/current/teams', headers: broke.h, payload: { name: 'Sem Grana', avatar_id: broke.a.id } });
    expect(nope.json().error.code).toBe('insufficient_thaler');
    const other = await player();
    const notMine = await app.inject({ method: 'POST', url: '/v1/championships/current/teams', headers: other.h, payload: { name: 'Alheio', avatar_id: extra.a.id } });
    expect(notMine.statusCode).toBe(404);

    const now = (await app.inject({ url: '/v1/championships/current', headers: other.h })).json();
    expect(now.championship).toMatchObject({ id: '2026-11', status: 'open', pool: '18000', seed: null, me: null });
    expect(now.championship.teams.map((t: { name: string; players: number; full: boolean }) => [t.name, t.players, t.full])).toEqual([
      ['Azul', 6, true],
      ['Verde', 6, true],
      ['Branco', 6, true],
    ]);
    expect(now.rules).toMatchObject({ entry: '1000', team_size: 6, prizes: [0.5, 0.35, 0.15] });

    clock = new Date('2026-12-01T00:00:01Z');
    const closed = await app.inject({ method: 'POST', url: '/v1/championships/current/teams', headers: other.h, payload: { name: 'Atrasado', avatar_id: other.a.id } });
    expect(closed.statusCode).toBe(201); // já é o campeonato de dezembro
    const after = (await app.inject({ url: '/v1/championships/current', headers: other.h })).json();
    expect(after.championship.id).toBe('2026-12');
    expect(after.last).toMatchObject({ id: '2026-11', status: 'settled', seed: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(after.last.result).toMatchObject({ played: true, poolCents: '18000' });
    expect(payer.burned).toBeGreaterThanOrEqual(4500n);
    // O escrow de novembro zerou; sobra só a inscrição de dezembro.
    expect(payer.escrow).toBe(1000n);
  });
});
