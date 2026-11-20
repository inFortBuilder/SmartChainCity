import { randomUUID } from 'node:crypto';

import { AppError } from '@scc/shared';

import {
  type Avatar,
  type AvatarStore,
  MAX_AVATARS_PER_ACCOUNT,
  decayDue,
  decayed,
  tooManyAvatars,
} from '../domain/avatar.js';
import { type HospitalStay, type HospitalStore, admit } from '../domain/hospital.js';
import { type Meal, type MealPlanner, type MealStore, eat } from '../domain/meal.js';
import { type Shift, type ShiftPlanner, type ShiftStore, hoursSince, settle } from '../domain/shift.js';

const cloneShift = (s: Shift): Shift => ({ ...s, snapshot: { ...s.snapshot }, result: s.result && { ...s.result } });

const cloneMeal = (m: Meal): Meal => ({ ...m, effects: { ...m.effects } });

const clone = (a: Avatar): Avatar => ({
  ...a,
  attributes: { ...a.attributes },
  anchors: { ...a.anchors },
  conditions: a.conditions.map((c) => ({ ...c })),
  pantry: { ...a.pantry },
});

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryAvatarStore implements AvatarStore, ShiftStore, MealStore, HospitalStore {
  private readonly avatars = new Map<string, Avatar>();
  private readonly stays = new Map<string, HospitalStay>();

  async admitDue(now: Date, batch: number, avatarId?: string) {
    const created: HospitalStay[] = [];
    for (const [id, stored] of this.avatars) {
      if (created.length >= batch) break;
      if (avatarId && id !== avatarId) continue;
      const working = [...this.shifts.values()].some((s) => s.avatarId === id && s.status === 'running' && s.endsAt > now);
      if (working) continue;
      const admitted = admit(decayed(stored, now), randomUUID(), now);
      if (!admitted) continue;
      this.avatars.set(id, clone(admitted.avatar));
      this.stays.set(admitted.stay.id, { ...admitted.stay });
      created.push({ ...admitted.stay });
    }
    return created;
  }

  async pendingFees(batch: number) {
    return [...this.stays.values()]
      .filter((s) => s.feeStatus === 'pending')
      .sort((a, b) => a.admittedAt.getTime() - b.admittedAt.getTime())
      .slice(0, batch)
      .map((s) => ({ ...s }));
  }

  async settleFee(stayId: string, status: 'paid' | 'waived') {
    const s = this.stays.get(stayId);
    if (s?.feeStatus === 'pending') this.stays.set(stayId, { ...s, feeStatus: status });
  }

  async listStays(avatarId: string, limit: number) {
    return [...this.stays.values()]
      .filter((s) => s.avatarId === avatarId)
      .sort((a, b) => b.admittedAt.getTime() - a.admittedAt.getTime())
      .slice(0, limit)
      .map((s) => ({ ...s }));
  }
  private readonly shifts = new Map<string, Shift>();
  private readonly meals = new Map<string, Meal>();

  async beginMeal(avatarId: string, accountId: string, clientKey: string | null, now: Date, plan: MealPlanner) {
    const stored = this.avatars.get(avatarId);
    if (!stored || stored.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    if (clientKey !== null) {
      const same = [...this.meals.values()].find((m) => m.accountId === accountId && m.clientKey === clientKey);
      if (same) return cloneMeal(same);
    }
    const meal = plan(decayed(stored, now));
    this.meals.set(meal.id, cloneMeal(meal));
    return cloneMeal(meal);
  }

  async finishMeal(mealId: string, now: Date) {
    const meal = this.meals.get(mealId);
    if (!meal) throw new AppError('not_found', 'Refeição não encontrada.', 404);
    if (meal.status !== 'pending') return cloneMeal(meal);
    const stored = this.avatars.get(meal.avatarId)!;
    this.avatars.set(stored.id, clone(eat(decayed(stored, now), meal.effects, now)));
    const done: Meal = { ...meal, status: 'eaten', eatenAt: now };
    this.meals.set(mealId, done);
    return cloneMeal(done);
  }

  async updateAvatar(avatarId: string, accountId: string, now: Date, plan: (avatar: Avatar) => Avatar) {
    const stored = this.avatars.get(avatarId);
    if (!stored || stored.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    const next = plan(decayed(stored, now));
    this.avatars.set(avatarId, clone(next));
    return clone(next);
  }

  async failMeal(mealId: string) {
    const meal = this.meals.get(mealId);
    if (!meal) throw new AppError('not_found', 'Refeição não encontrada.', 404);
    if (meal.status === 'pending') this.meals.set(mealId, { ...meal, status: 'failed' });
    return cloneMeal(this.meals.get(mealId)!);
  }

  async listMeals(avatarId: string, limit: number) {
    return [...this.meals.values()]
      .filter((m) => m.avatarId === avatarId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(cloneMeal);
  }

  async beginShift(avatarId: string, accountId: string, now: Date, plan: ShiftPlanner) {
    const stored = this.avatars.get(avatarId);
    if (!stored || stored.accountId !== accountId) throw new AppError('not_found', 'Avatar não encontrado.', 404);
    const own = [...this.shifts.values()].filter((s) => s.avatarId === avatarId);
    const { shift, avatar } = plan(decayed(stored, now), {
      hoursToday: hoursSince(own, now),
      running: own.some((s) => s.status === 'running'),
    });
    this.avatars.set(avatarId, clone(avatar));
    this.shifts.set(shift.id, cloneShift(shift));
    return cloneShift(shift);
  }

  async completeDue(now: Date, batch: number) {
    let done = 0;
    for (const [id, s] of this.shifts) {
      if (done >= batch) break;
      if (s.status !== 'running' || s.endsAt > now) continue;
      this.shifts.set(id, { ...s, status: 'done', result: settle(s) });
      done++;
    }
    return done;
  }

  async listShifts(avatarId: string, limit: number) {
    return [...this.shifts.values()]
      .filter((s) => s.avatarId === avatarId)
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .slice(0, limit)
      .map(cloneShift);
  }

  async markClaimed(shiftId: string) {
    const s = this.shifts.get(shiftId);
    if (s?.status === 'done') this.shifts.set(shiftId, { ...s, status: 'claimed' });
  }

  async create(avatar: Avatar) {
    const owned = [...this.avatars.values()].filter((a) => a.accountId === avatar.accountId).length;
    if (owned >= MAX_AVATARS_PER_ACCOUNT) throw tooManyAvatars();
    this.avatars.set(avatar.id, clone(avatar));
    return clone(avatar);
  }

  async get(id: string) {
    const a = this.avatars.get(id);
    return a ? clone(a) : null;
  }

  async listByAccount(accountId: string) {
    return [...this.avatars.values()]
      .filter((a) => a.accountId === accountId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }

  async applyDecay(now: Date, batch: number) {
    let done = 0;
    for (const [id, a] of this.avatars) {
      if (done >= batch) break;
      if (!decayDue(a, now)) continue;
      this.avatars.set(id, { ...decayed(a, now), updatedAt: now });
      done++;
    }
    return done;
  }
}
