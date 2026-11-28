import { randomUUID } from "node:crypto";

import { AppError } from "@scc/shared";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { newAvatar } from "../src/domain/avatar.js";
import type { Meal, MealPayer } from "../src/domain/meal.js";
import type { VehiclePayer } from "../src/domain/vehicle.js";
import { MemoryAvatarStore } from "../src/infra/memory-store.js";
import { MemoryVehicleStore } from "../src/infra/memory-vehicle-store.js";

const SECRET = "segredo-de-teste-com-mais-de-32-caracteres"; // gitleaks:allow (só no teste)
const INTERNAL = "chave-interna-de-teste-com-mais-de-32-caracteres"; // gitleaks:allow (só no teste)
const config = loadConfig({
  NODE_ENV: "test",
  JWT_SECRET: SECRET,
  INTERNAL_TOKEN: INTERNAL,
});
const t0 = new Date("2026-11-28T10:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Ledger falso: saldo por conta, as chaves já cobradas e os lançamentos. */
class FakeLedger implements MealPayer, VehiclePayer {
  balances = new Map<string, bigint>();
  keys = new Set<string>();
  entries: { kind: string; sink: string; cents: bigint }[] = [];
  private take(accountId: string, cents: bigint) {
    const b = this.balances.get(accountId) ?? 0n;
    if (b < cents)
      throw new AppError("insufficient_thaler", "THALER insuficiente.", 409);
    this.balances.set(accountId, b - cents);
  }
  async chargeMeal(meal: Meal) {
    this.take(meal.accountId, meal.priceCents);
  }
  async chargeVehicle(i: {
    key: string;
    kind: string;
    accountId: string;
    cents: bigint;
    sink: string;
  }) {
    if (this.keys.has(i.key)) return;
    this.take(i.accountId, i.cents);
    this.keys.add(i.key);
    this.entries.push({ kind: i.kind, sink: i.sink, cents: i.cents });
  }
  async chargeFuel() {}
  async payPrize() {}
  async payBuyback() {}
}

describe("dirigir o próprio carro na rua", () => {
  let ledger: FakeLedger;
  let avatars: MemoryAvatarStore;
  let clock: Date;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ledger = new FakeLedger();
    avatars = new MemoryAvatarStore();
    clock = t0;
    app = await buildApp(
      config,
      avatars,
      () => clock,
      null,
      ledger,
      null,
      () => 0.5,
      null,
      null,
      null,
      { store: new MemoryVehicleStore(), payer: ledger },
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

  /** Conta com avatar (sem a conta das 16 h acordado) e o saldo dado. */
  const setup = async (balance = 1_000_000n) => {
    const me = randomUUID();
    ledger.balances.set(me, balance);
    const a = await avatars.create({
      ...newAvatar(
        {
          id: randomUUID(),
          accountId: me,
          rarity: "common",
          jobCode: "padeiro",
        },
        t0,
      ),
      awakeSince: null,
    });
    return { me, a, h: await auth(me) };
  };

  it("sem habilitação não dirige; na autoescola também não; habilitado, paga 2 THALER por saída", async () => {
    const { me, a, h } = await setup();
    const car = (
      await app.inject({
        method: "POST",
        url: "/v1/vehicles",
        headers: h,
        payload: { model: "hatch" },
      })
    ).json().vehicle.id;
    const drive = (headers: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: `/v1/avatars/${a.id}/drive`,
        headers,
        payload: { vehicle: car },
      });

    let r = await drive(h);
    expect(r.json().error.code).toBe("no_license");
    await app.inject({
      method: "POST",
      url: `/v1/avatars/${a.id}/license`,
      headers: h,
    });
    r = await drive(h);
    expect(r.json().error.code).toBe("in_driving_school");

    clock = new Date(t0.getTime() + 3 * HOUR);
    const before = ledger.balances.get(me)!;
    const key = { ...h, "idempotency-key": randomUUID() };
    r = await drive(key);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      fuel_cents: "200",
      vehicle: { id: car, state: "ok" },
      avatar: { id: a.id },
    });
    // A mesma chave cobra uma vez; outra saída cobra de novo.
    await drive(key);
    expect(ledger.balances.get(me)).toBe(before - 200n);
    await drive({ ...h, "idempotency-key": randomUUID() });
    expect(ledger.balances.get(me)).toBe(before - 400n);
    expect(ledger.entries.filter((e) => e.kind === "drive_fuel")).toEqual([
      { kind: "drive_fuel", sink: "fuel", cents: 200n },
      { kind: "drive_fuel", sink: "fuel", cents: 200n },
    ]);
  });

  it("carro com o IPVA atrasado não roda; carro de outra conta é 404; o catálogo mostra o combustível", async () => {
    const { a, h } = await setup();
    await app.inject({
      method: "POST",
      url: `/v1/avatars/${a.id}/license`,
      headers: h,
    });
    const car = (
      await app.inject({
        method: "POST",
        url: "/v1/vehicles",
        headers: h,
        payload: { model: "hatch" },
      })
    ).json().vehicle.id;
    clock = new Date(t0.getTime() + 183 * DAY);
    const late = await app.inject({
      method: "POST",
      url: `/v1/avatars/${a.id}/drive`,
      headers: h,
      payload: { vehicle: car },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe("vehicle_unavailable");

    const other = await setup();
    const theirs = await app.inject({
      method: "POST",
      url: `/v1/avatars/${other.a.id}/drive`,
      headers: other.h,
      payload: { vehicle: car },
    });
    expect(theirs.statusCode).toBe(404);

    const cat = await app.inject({ url: "/v1/catalog/routine" });
    expect(cat.json().drive_fuel).toBe("200");
  });

  it("sem THALER para o combustível é 409", async () => {
    const { me, a, h } = await setup(5_000n + 300_000n);
    await app.inject({
      method: "POST",
      url: `/v1/avatars/${a.id}/license`,
      headers: h,
    });
    const car = (
      await app.inject({
        method: "POST",
        url: "/v1/vehicles",
        headers: h,
        payload: { model: "hatch" },
      })
    ).json().vehicle.id;
    expect(ledger.balances.get(me)).toBe(0n);
    clock = new Date(t0.getTime() + 3 * HOUR);
    const r = await app.inject({
      method: "POST",
      url: `/v1/avatars/${a.id}/drive`,
      headers: h,
      payload: { vehicle: car },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("insufficient_thaler");
  });
});
