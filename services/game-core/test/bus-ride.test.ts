import { randomUUID } from "node:crypto";

import { AppError } from "@scc/shared";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { type Avatar, newAvatar } from "../src/domain/avatar.js";
import { catchCondition } from "../src/domain/conditions.js";
import { type Meal, type MealPayer, planBusRide } from "../src/domain/meal.js";
import { COMMUTES } from "../src/domain/routine.js";
import { EconomyPayer } from "../src/infra/economy-payer.js";
import { MemoryAvatarStore } from "../src/infra/memory-store.js";

const SECRET = "segredo-de-teste-com-mais-de-32-caracteres"; // gitleaks:allow (só no teste)
const INTERNAL = "chave-interna-de-teste-com-mais-de-32-caracteres"; // gitleaks:allow (só no teste)
const config = loadConfig({
  NODE_ENV: "test",
  JWT_SECRET: SECRET,
  INTERNAL_TOKEN: INTERNAL,
});
const t0 = new Date("2026-11-28T10:00:00Z");

const make = (over: Partial<Avatar> = {}): Avatar => {
  const a = newAvatar(
    {
      id: randomUUID(),
      accountId: randomUUID(),
      rarity: "common",
      jobCode: "padeiro",
    },
    t0,
  );
  return { ...a, awakeSince: null, ...over };
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
};
const ride = (a: Avatar, resting = false) =>
  planBusRide(
    a,
    {
      id: randomUUID(),
      clientKey: null,
      fareCents: COMMUTES.onibus.costCents,
      resting,
    },
    t0,
  );

describe("passagem de ônibus na rua", () => {
  it("custa o mesmo que o deslocamento de ônibus do turno (3 THALER) e não muda o avatar", () => {
    const m = ride(make());
    expect(m).toMatchObject({
      foodCode: "onibus",
      priceCents: 300n,
      effects: { food: 0, energy: 0, health: 0 },
      status: "pending",
    });
  });

  it("internado, dormindo ou de cama não embarca; com dor de cabeça embarca", () => {
    expect(
      code(() =>
        ride(make({ hospitalUntil: new Date(t0.getTime() + 3_600_000) })),
      ),
    ).toBe("in_hospital");
    expect(code(() => ride(make(), true))).toBe("resting");
    expect(
      code(() => ride(make({ conditions: catchCondition([], "gripe", t0) }))),
    ).toBe("sick");
    expect(
      code(() =>
        ride(make({ conditions: catchCondition([], "dor_de_cabeca", t0) })),
      ),
    ).toBeNull();
  });

  it("o ledger manda a passagem para a queima do transporte", async () => {
    const bodies: {
      kind: string;
      legs: { owner_type: string; owner_id: string; amount: string }[];
    }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    const a = make();
    await new EconomyPayer("http://economy", "token", fetchFn).chargeMeal(
      ride(a),
    );
    expect(bodies[0]).toMatchObject({
      kind: "bus_fare",
      legs: [
        { owner_type: "player", owner_id: a.accountId, amount: "-300" },
        { owner_type: "burn", owner_id: "transit", amount: "300" },
      ],
    });
  });
});

/** Ledger falso com saldo por conta. */
class FakeLedger implements MealPayer {
  balances = new Map<string, bigint>();
  async chargeMeal(meal: Meal) {
    const balance = this.balances.get(meal.accountId) ?? 0n;
    if (balance < meal.priceCents)
      throw new AppError("insufficient_thaler", "THALER insuficiente.", 409);
    this.balances.set(meal.accountId, balance - meal.priceCents);
  }
}

describe("API da passagem", () => {
  let ledger: FakeLedger;
  let store: MemoryAvatarStore;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    store = new MemoryAvatarStore();
    app = await buildApp(
      config,
      store,
      () => t0,
      null,
      ledger,
      null,
      () => 0.5,
    );
  });

  const auth = async (accountId: string) => ({
    authorization: `Bearer ${await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(accountId)
      .setIssuer("scc-gateway")
      .setAudience("scc-api")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(SECRET))}`,
  });

  it("cobra 3 THALER uma vez por Idempotency-Key e devolve a passagem e o avatar", async () => {
    const a = await store.create(make());
    ledger.balances.set(a.accountId, 1000n);
    const headers = {
      ...(await auth(a.accountId)),
      "idempotency-key": randomUUID(),
    };
    const r = await app.inject({
      method: "POST",
      url: `/v1/avatars/${a.id}/bus-ride`,
      headers,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      ride: { food: "onibus", price: "300", status: "eaten" },
      avatar: { id: a.id },
    });
    const again = await app.inject({
      method: "POST",
      url: `/v1/avatars/${a.id}/bus-ride`,
      headers,
    });
    expect(again.statusCode).toBe(201);
    expect(ledger.balances.get(a.accountId)).toBe(700n);
  });

  it("sem THALER é 409; de outra conta é 404; o catálogo mostra o preço", async () => {
    const a = await store.create(make());
    const r = await app.inject({
      method: "POST",
      url: `/v1/avatars/${a.id}/bus-ride`,
      headers: await auth(a.accountId),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("insufficient_thaler");
    const other = await app.inject({
      method: "POST",
      url: `/v1/avatars/${a.id}/bus-ride`,
      headers: await auth(randomUUID()),
    });
    expect(other.statusCode).toBe(404);
    const cat = await app.inject({ url: "/v1/catalog/routine" });
    expect(cat.json().bus_fare).toBe("300");
  });
});
