import {
  type Avatar,
  type AvatarStore,
  MAX_AVATARS_PER_ACCOUNT,
  decayDue,
  decayed,
  tooManyAvatars,
} from '../domain/avatar.js';

const clone = (a: Avatar): Avatar => ({
  ...a,
  attributes: { ...a.attributes },
  anchors: { ...a.anchors },
});

/** Para testes e desenvolvimento. Uma thread só: cada operação é atômica. */
export class MemoryAvatarStore implements AvatarStore {
  private readonly avatars = new Map<string, Avatar>();

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
