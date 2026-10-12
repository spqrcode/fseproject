/**
 * Integration tests for the scenario domain layer against a real PostgreSQL database.
 *
 * These tests prove:
 *  1. The original CashEvent's persisted row is unchanged after a scenario is applied.
 *  2. The base forecast result is unchanged.
 *  3. Cross-workspace access is rejected.
 *  4. Two scenarios targeting the same event do not affect each other.
 *  5. Invalid adjustments surface explicitly while hard deletion cascades safely.
 */

import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { hashPassword } from "@/lib/password";
import {
  createCashAccount,
  createCashEvent,
  deleteCashEvent,
  listCashEvents,
  setCashEventStatus,
  type CashEvent as StoredCashEvent,
} from "@/lib/cash-events-store";
import { saveWorkspace } from "@/lib/workspace-store";
import {
  getScenario,
  createScenario,
  addDelayAdjustment,
  DuplicateDelayAdjustmentError,
  getAdjustments,
  invalidateAdjustment,
} from "@/lib/scenario-store";
import {
  runForecast,
  runScenarioForecast,
  InvalidAdjustmentError,
  parseCashEvent,
  type CashEvent as ForecastCashEvent,
} from "@/lib/forecast";

// ---------------------------------------------------------------------------
// Guard: must run against the isolated test database
// ---------------------------------------------------------------------------
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test") || process.env.DATABASE_URL !== url) {
  throw new Error("Run npm run test:integration against an isolated _test database.");
}

// ---------------------------------------------------------------------------
// Mock Next.js headers (required by server-only imports)
// ---------------------------------------------------------------------------
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "http://localhost:3100" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emails: string[] = [];
const ids: string[] = [];
let alice: string;
let bob: string;
let aliceAccountId: string;
let bobAccountId: string;
let passwordHash: string;
const password = "a test-only long passphrase";

function uniqueEmail() {
  const email = `scenario-int-${randomUUID()}@example.com`;
  emails.push(email);
  return email;
}

async function createUser(email: string) {
  const result = await database().query(
    "INSERT INTO users(email, password_hash) VALUES ($1, $2) RETURNING id",
    [email, passwordHash],
  );
  const id = result.rows[0].id as string;
  ids.push(id);
  return id;
}

beforeAll(async () => {
  passwordHash = await hashPassword(password);
});

beforeEach(async () => {
  const aliceId = await createUser(uniqueEmail());
  const bobId = await createUser(uniqueEmail());
  alice = (await createSession(aliceId)).token;
  bob = (await createSession(bobId)).token;
  await saveWorkspace(alice, "Alice workspace");
  await saveWorkspace(bob, "Bob workspace");
  aliceAccountId = (await createCashAccount(alice, {
    name: "Main",
    currency: "EUR",
    openingBalance: "1000",
  }))!.id;
  bobAccountId = (await createCashAccount(bob, {
    name: "Main",
    currency: "EUR",
    openingBalance: "1000",
  }))!.id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
  ids.length = 0;
});

afterAll(async () => {
  await database().end();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function aliceEvent(amount = "500", date = "2025-03-01") {
  return (await createCashEvent(alice, aliceAccountId, {
    description: "Test invoice",
    amount,
    expectedDate: date,
  }))!;
}

async function getCashEvent(token: string, eventId: string) {
  return (await listCashEvents(token)).find((event) => event.id === eventId) ?? null;
}

function forecastEvent(event: StoredCashEvent): ForecastCashEvent {
  return parseCashEvent({
    id: event.id,
    amount: event.amount,
    currency: event.currency,
    expectedDate: event.expectedDate,
    createdAt: event.createdAt.toISOString(),
    status: event.status === "expected" ? "pending" : event.status === "cancelled" ? "cancelled" : "completed",
  });
}

const BASE = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  openingBalance: "1000",
  dangerThreshold: null,
  currency: "EUR" as const,
};

// ---------------------------------------------------------------------------
// 1. Persisted CashEvent row is unchanged after scenario runs
// ---------------------------------------------------------------------------

describe("persisted CashEvent is unchanged", () => {
  it("reads the same expectedDate from the DB after a scenario is applied in memory", async () => {
    const event = await aliceEvent("300", "2025-03-01");

    // Load from DB again before scenario
    const before = await getCashEvent(alice, event.id);
    expect(before?.expectedDate).toBe("2025-03-01");

    // Run a scenario in memory — does not touch the DB
    const projectedEvent = forecastEvent(event);
    const baseForecast = runForecast({ ...BASE, events: [projectedEvent] });
    runScenarioForecast({
      scenarioId: "in-memory-only",
      adjustments: [{ id: "a", scenarioId: "s", cashEventId: event.id, dateOverride: "2025-06-01", status: "active" }],
      baseEvents: [projectedEvent],
      baseForecast,
      startDate: BASE.startDate,
      endDate: BASE.endDate,
      currency: BASE.currency,
    });

    // Reload from DB — date must be unchanged
    const after = await getCashEvent(alice, event.id);
    expect(after?.expectedDate).toBe("2025-03-01");
    expect(after?.amount).toBe(before?.amount);
  });

  it("round-trips cash-event and adjustment dates as date-only strings", async () => {
    const event = await aliceEvent("300", "2026-10-15");
    const scenario = await createScenario(alice, "Date-only scenario");
    const adjustment = await addDelayAdjustment(
      alice,
      scenario.id,
      event.id,
      "2026-10-25",
    );

    expect(event.expectedDate).toBe("2026-10-15");
    expect(typeof event.expectedDate).toBe("string");
    expect(adjustment.dateOverride).toBe("2026-10-25");
    expect(typeof adjustment.dateOverride).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-workspace access is rejected
// ---------------------------------------------------------------------------

describe("cross-workspace access rejection", () => {
  it("alice cannot see bob's cash events", async () => {
    await createCashEvent(bob, bobAccountId, {
      description: "Bob's secret invoice",
      amount: "9999",
      expectedDate: "2025-05-01",
    });
    const aliceEvents = await listCashEvents(alice);
    expect(aliceEvents.every((e) => e.amount !== "9999")).toBe(true);
  });

  it("bob cannot access alice's scenario by guessing its ID", async () => {
    const scenario = await createScenario(alice, "Alice private");
    const fromBob = await getScenario(bob, scenario.id);
    expect(fromBob).toBeNull();
  });

  it("bob cannot add an adjustment to alice's scenario", async () => {
    const aliceScenario = await createScenario(alice, "Alice scenario");
    const aliceEv = await aliceEvent();
    await expect(
      addDelayAdjustment(bob, aliceScenario.id, aliceEv.id, "2025-06-01"),
    ).rejects.toThrow("requires an owned scenario");
  });

  it("anonymous token cannot access any cash events or scenarios", async () => {
    await aliceEvent();
    expect(await listCashEvents(undefined)).toEqual([]);
    expect(await listCashEvents("0".repeat(64))).toEqual([]);
    expect(await getScenario(undefined, "any-id")).toBeNull();
  });

  it("alice cannot add an adjustment targeting bob's event to her own scenario", async () => {
    const aliceScenario = await createScenario(alice, "Alice scenario");
    const bobEv = (await createCashEvent(bob, bobAccountId, {
      description: "Bob event",
      amount: "100",
      expectedDate: "2025-04-01",
    }))!;
    await expect(
      addDelayAdjustment(alice, aliceScenario.id, bobEv.id, "2025-06-01"),
    ).rejects.toThrow("requires an owned scenario");
  });

  it("the database composite key rejects a cross-workspace event even if application checks are bypassed", async () => {
    const aliceScenario = await createScenario(alice, "Alice scenario");
    const bobEv = (await createCashEvent(bob, bobAccountId, {
      description: "Bob event",
      amount: "100",
      expectedDate: "2025-04-01",
    }))!;

    await expect(database().query(
      `INSERT INTO scenario_adjustments(workspace_id, scenario_id, cash_event_id, date_override)
       VALUES ($1, $2, $3, '2025-06-01')`,
      [aliceScenario.workspaceId, aliceScenario.id, bobEv.id],
    )).rejects.toMatchObject({ code: "23503" });
  });

  it("treats malformed UUIDs like missing records instead of leaking PostgreSQL errors", async () => {
    const event = await aliceEvent();

    expect(await getCashEvent(alice, "not-a-uuid")).toBeNull();
    expect(await deleteCashEvent(alice, "not-a-uuid")).toBe(false);
    expect(await getScenario(alice, "not-a-uuid")).toBeNull();
    expect(await getAdjustments(alice, "not-a-uuid")).toEqual([]);
    expect(await invalidateAdjustment(alice, "not-a-uuid")).toBe(false);
    await expect(
      addDelayAdjustment(alice, "not-a-uuid", event.id, "2025-06-01"),
    ).rejects.toThrow("Scenario not found or access denied");
  });
});

describe("delayed-invoice eligibility", () => {
  it("requires an expected income event and a strictly later valid date", async () => {
    const scenario = await createScenario(alice, "Eligibility");
    const invoice = await aliceEvent("200", "2025-04-01");
    const expense = await aliceEvent("-50", "2025-04-01");
    const settled = await aliceEvent("300", "2025-04-01");
    await setCashEventStatus(alice, settled.id, "received");

    for (const [eventId, date] of [
      [invoice.id, "2025-04-01"],
      [invoice.id, "2025-03-31"],
      [expense.id, "2025-05-01"],
      [settled.id, "2025-05-01"],
    ]) {
      await expect(addDelayAdjustment(alice, scenario.id, eventId, date))
        .rejects.toThrow("requires an owned scenario");
    }
    await expect(addDelayAdjustment(alice, scenario.id, invoice.id, "2025-02-30"))
      .rejects.toThrow();
    expect(await getAdjustments(alice, scenario.id)).toEqual([]);
  });

  it("returns an explicit domain error for a duplicate event adjustment", async () => {
    const scenario = await createScenario(alice, "Duplicate protection");
    const invoice = await aliceEvent("200", "2025-04-01");
    await addDelayAdjustment(alice, scenario.id, invoice.id, "2025-05-01");

    await expect(addDelayAdjustment(alice, scenario.id, invoice.id, "2025-06-01"))
      .rejects.toBeInstanceOf(DuplicateDelayAdjustmentError);
    expect(await getAdjustments(alice, scenario.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Two scenarios targeting the same event are independent
// ---------------------------------------------------------------------------

describe("two scenarios targeting the same event", () => {
  it("adjustments in different scenarios do not affect each other", async () => {
    const event = await aliceEvent("400", "2025-03-01");
    const scenarioA = await createScenario(alice, "Scenario A");
    const scenarioB = await createScenario(alice, "Scenario B");

    const adjA = await addDelayAdjustment(alice, scenarioA.id, event.id, "2025-05-01");
    const adjB = await addDelayAdjustment(alice, scenarioB.id, event.id, "2025-09-01");

    expect(adjA.dateOverride).toBe("2025-05-01");
    expect(adjB.dateOverride).toBe("2025-09-01");

    const adjsA = await getAdjustments(alice, scenarioA.id);
    const adjsB = await getAdjustments(alice, scenarioB.id);

    expect(adjsA).toHaveLength(1);
    expect(adjsB).toHaveLength(1);
    expect(adjsA[0].dateOverride).toBe("2025-05-01");
    expect(adjsB[0].dateOverride).toBe("2025-09-01");
  });
});

// ---------------------------------------------------------------------------
// 4. Invalid / deleted target event produces explicit error state
// ---------------------------------------------------------------------------

describe("invalid adjustments and safe deletion", () => {
  it("invalidateAdjustment marks status=invalid and applyDelayAdjustment then throws", async () => {
    const event = await aliceEvent("200", "2025-04-01");
    const scenario = await createScenario(alice, "Scenario with invalid adj");
    const adj = await addDelayAdjustment(alice, scenario.id, event.id, "2025-07-01");

    expect(adj.status).toBe("active");

    // Mark as invalid so callers must surface the unusable override explicitly.
    await invalidateAdjustment(alice, adj.id);

    const adjsAfter = await getAdjustments(alice, scenario.id);
    expect(adjsAfter[0].status).toBe("invalid");

    // The domain layer must throw, not silently ignore
    const events: ForecastCashEvent[] = [forecastEvent(event)];
    const baseForecast = runForecast({ ...BASE, events });
    expect(() =>
      runScenarioForecast({
        scenarioId: scenario.id,
        adjustments: adjsAfter,
        baseEvents: events,
        baseForecast,
        startDate: BASE.startDate,
        endDate: BASE.endDate,
        currency: BASE.currency,
      }),
    ).toThrow(InvalidAdjustmentError);
  });

  it("hard-deleting a cash event cascades its scenario adjustment", async () => {
    const event = await aliceEvent("150", "2025-04-01");
    const scenario = await createScenario(alice, "Scenario referencing event");
    await addDelayAdjustment(alice, scenario.id, event.id, "2025-07-01");

    expect(await getAdjustments(alice, scenario.id)).toHaveLength(1);
    expect(await deleteCashEvent(alice, event.id)).toBe(true);
    expect(await getAdjustments(alice, scenario.id)).toEqual([]);
  });

  it("deleting a user cascades events, scenarios, and adjustments", async () => {
    const event = await aliceEvent("150", "2025-04-01");
    const scenario = await createScenario(alice, "Scenario referencing event");
    const adjustment = await addDelayAdjustment(
      alice,
      scenario.id,
      event.id,
      "2025-07-01",
    );
    const aliceId = ids[0];

    await database().query("DELETE FROM users WHERE id = $1", [aliceId]);

    const eventCount = await database().query(
      "SELECT count(*)::int AS count FROM cash_events WHERE id = $1",
      [event.id],
    );
    const scenarioCount = await database().query(
      "SELECT count(*)::int AS count FROM scenarios WHERE id = $1",
      [scenario.id],
    );
    const adjustmentCount = await database().query(
      "SELECT count(*)::int AS count FROM scenario_adjustments WHERE id = $1",
      [adjustment.id],
    );

    expect(eventCount.rows[0].count).toBe(0);
    expect(scenarioCount.rows[0].count).toBe(0);
    expect(adjustmentCount.rows[0].count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Base forecast result is unchanged after persisting and loading scenarios
// ---------------------------------------------------------------------------

describe("base forecast is unchanged when scenario store is used", () => {
  it("loading a scenario and its adjustments does not change the base event or forecast", async () => {
    const event = await aliceEvent("600", "2025-06-15");
    const baseForecast = runForecast({ ...BASE, events: [forecastEvent(event)] });
    const closingBefore = baseForecast.closingBalance;

    const scenario = await createScenario(alice, "Delay scenario");
    await addDelayAdjustment(alice, scenario.id, event.id, "2025-09-30");

    // Reload events from DB
    const reloaded = await listCashEvents(alice);
    const reloadedForecast = runForecast({ ...BASE, events: reloaded.map(forecastEvent) });

    // Base forecast (reloaded from DB, no adjustments applied) is unchanged
    expect(reloadedForecast.closingBalance).toBe(closingBefore);
    expect(reloaded.find((e) => e.id === event.id)?.expectedDate).toBe("2025-06-15");
  });
});
