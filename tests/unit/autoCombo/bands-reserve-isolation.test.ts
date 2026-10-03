import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreparedStatement, SqliteAdapter } from "../../../src/lib/db/adapters/types";
import type { BandReserveConfig } from "../../../open-sse/services/autoCombo/bands/config";
import type { ReserveController } from "../../../open-sse/services/autoCombo/bands/reserve";

const radarSyncAudit = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    fail(name: string): never {
      calls.push(name);
      throw new Error(`unexpected Radar sync during reserve refresh: ${name}`);
    },
    reset(): void {
      calls.length = 0;
    },
  };
});

// AICODE-NOTE: Mock every current Radar sync entrypoint so an accidental reserve call fails offline.
vi.mock("../../../src/lib/radar/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/radar/sync")>();
  return {
    ...actual,
    syncRadar: vi.fn(async () => radarSyncAudit.fail("syncRadar")),
  };
});

vi.mock("../../../src/lib/radar/offersSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/radar/offersSync")>();
  return {
    ...actual,
    syncRadarOffers: vi.fn(async () => radarSyncAudit.fail("syncRadarOffers")),
  };
});

vi.mock("../../../src/lib/radar/intelSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/radar/intelSync")>();
  return {
    ...actual,
    syncRadarIntel: vi.fn(async () => radarSyncAudit.fail("syncRadarIntel")),
  };
});

vi.mock("../../../src/lib/radar/referralsSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/radar/referralsSync")>();
  return {
    ...actual,
    syncRadarReferrals: vi.fn(async () => radarSyncAudit.fail("syncRadarReferrals")),
  };
});

vi.mock("../../../src/lib/radar/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/radar/scheduler")>();
  return {
    ...actual,
    radarSchedulerTick: vi.fn(async () => radarSyncAudit.fail("radarSchedulerTick")),
    ensureRadarSyncScheduler: vi.fn(() => radarSyncAudit.fail("ensureRadarSyncScheduler")),
    initRadarSyncScheduler: vi.fn(() => radarSyncAudit.fail("initRadarSyncScheduler")),
  };
});

const originalEnv = {
  dataDir: process.env.DATA_DIR,
  bands: process.env.OMNIROUTE_AUTO_BANDS,
  radar: process.env.RADAR_ENABLED,
};

let temporaryDataDir: string | undefined;
let resetDbInstance: (() => void) | undefined;

function makeSettings(enabled: boolean): BandReserveConfig {
  return {
    enabled,
    lookbackDays: 7,
    refreshMinutes: 10,
    maxAgeMinutes: 60,
    maxSnapshotAgeMinutes: 30,
    floorPct: 10,
    staticReservePct: { mid: 0, high: 0 },
    axes: { live: true, daily: true, monthly: true },
  };
}

function auditDatabaseWrites(db: SqliteAdapter): { statements: string[]; writeCalls: string[] } {
  const statements: string[] = [];
  const writeCalls: string[] = [];
  const prepare = db.prepare.bind(db);

  // AICODE-NOTE: Guard adapter write calls during refresh while leaving its real read path intact.
  vi.spyOn(db, "prepare").mockImplementation((sql: string): PreparedStatement => {
    statements.push(sql);
    const statement = prepare(sql);
    return {
      all: (...params) => statement.all(...params),
      get: (...params) => statement.get(...params),
      run: (..._params) => {
        writeCalls.push(`prepare.run: ${sql}`);
        throw new Error("unexpected database write during reserve refresh");
      },
    };
  });

  vi.spyOn(db, "exec").mockImplementation((sql: string): void => {
    writeCalls.push(`exec: ${sql}`);
    throw new Error("unexpected database exec during reserve refresh");
  });

  return { statements, writeCalls };
}

async function startHarness(): Promise<{
  databaseAudit: ReturnType<typeof auditDatabaseWrites>;
  createController: (enabled: boolean, events: unknown[]) => ReserveController;
}> {
  temporaryDataDir = mkdtempSync(path.join(tmpdir(), "omniroute-bands-reserve-isolation-"));
  process.env.DATA_DIR = temporaryDataDir;
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  process.env.RADAR_ENABLED = "1";

  vi.resetModules();
  const dbModule = await import("../../../src/lib/db/core");
  resetDbInstance = dbModule.resetDbInstance;
  await dbModule.ensureDbInitialized();

  const db = dbModule.getDbInstance();
  const databaseAudit = auditDatabaseWrites(db);
  const { createReserveController } =
    await import("../../../open-sse/services/autoCombo/bands/reserve");

  return {
    databaseAudit,
    createController(enabled: boolean, events: unknown[]) {
      return createReserveController({
        getSettings: () => makeSettings(enabled),
        isBandsEnabled: () => true,
        deps: {
          now: () => new Date("2026-10-03T00:00:00.000Z"),
          log: (event) => events.push(event),
        },
      });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetDbInstance?.();
  resetDbInstance = undefined;
  if (temporaryDataDir) {
    rmSync(temporaryDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    temporaryDataDir = undefined;
  }
  if (originalEnv.dataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalEnv.dataDir;
  if (originalEnv.bands === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = originalEnv.bands;
  if (originalEnv.radar === undefined) delete process.env.RADAR_ENABLED;
  else process.env.RADAR_ENABLED = originalEnv.radar;
  radarSyncAudit.reset();
});

describe("auto quality band reserve isolation", () => {
  it("refreshes through real source adapters without invoking Radar sync or database writes", async () => {
    const harness = await startHarness();
    const events: unknown[] = [];
    const controller = harness.createController(true, events);

    expect(controller.getReserveSnapshot()).toBeNull();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "reserve-refresh" });
    expect(radarSyncAudit.calls).toEqual([]);
    expect(harness.databaseAudit.writeCalls).toEqual([]);

    const readSql = harness.databaseAudit.statements.join("\n").toLowerCase();
    expect(readSql).toContain("from call_logs");
    expect(readSql).toContain("from quota_snapshots");
    expect(readSql).toContain("from radar_feed_cache");
  }, 30_000);

  it("keeps disabled reserve as a full stop for readers, sync, diagnostics, and writes", async () => {
    const harness = await startHarness();
    const events: unknown[] = [];
    const controller = harness.createController(false, events);

    expect(controller.getReserveSnapshot()).toBeNull();
    expect(controller.isReserved("low", "account-a", "openrouter", "model-a")).toBe(false);
    expect(events).toEqual([]);
    expect(harness.databaseAudit.statements).toEqual([]);
    expect(harness.databaseAudit.writeCalls).toEqual([]);
    expect(radarSyncAudit.calls).toEqual([]);
  }, 30_000);
});
