import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BandConfig,
  BandRange,
  BandTask,
  BandTaskOverrides,
} from "../../../open-sse/services/autoCombo/bands/config";
import { loadBandCalibrationReportConfig } from "../../../scripts/ad-hoc/bands-calibrate";
import { setUserFitnessOverride } from "../../../open-sse/services/autoCombo/taskFitness";
import { setCalibratedBandRanges } from "../../../open-sse/services/autoCombo/bands/config";
import {
  buildBandCalibrationReport,
  createBandCalibrationController,
  type BandCalibrationReportCandidate,
} from "../../../open-sse/services/autoCombo/bands/calibrate";

const { observeBandCandidateMock } = vi.hoisted(() => ({
  observeBandCandidateMock: vi.fn(),
}));

vi.mock("../../../open-sse/services/autoCombo/bands/calibrate", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../open-sse/services/autoCombo/bands/calibrate")
  >()),
  observeBandCandidate: observeBandCandidateMock,
}));

import { buildBandCheck } from "../../../open-sse/services/autoCombo/bands";
import { createVirtualAutoComboFromPrepared } from "../../../open-sse/services/autoCombo/virtualFactory";

type Rating = { score: number; source: string };
type ModelRatings = Partial<Record<BandTask, Rating>>;

const temporaryDirectories: string[] = [];

function makeTempDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "omniroute-band-calibration-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  vi.unstubAllEnvs();
  setCalibratedBandRanges(null);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createHarness(
  options: {
    ratings?: Map<string, ModelRatings>;
    calibration?: Partial<BandConfig["calibration"]>;
    mode?: BandConfig["calibration"]["mode"];
    tasks?: BandTaskOverrides;
    configPath?: string | null;
    now?: number;
  } = {}
) {
  let now = options.now ?? 1_000_000;
  let calibrated: BandTaskOverrides = {};
  const settings: BandConfig = {
    bands: {
      low: { min: 0, max: 0.55 },
      mid: { min: 0.45, max: 0.8 },
      high: { min: 0.7, max: 1 },
    },
    tasks: options.tasks ?? {},
    ratedSources: ["user_override", "arena_elo"],
    capabilities: { so: { unknown: "deny" } },
    reserve: {
      enabled: false,
      lookbackDays: 7,
      refreshMinutes: 10,
      maxAgeMinutes: 60,
      maxSnapshotAgeMinutes: 30,
      floorPct: 10,
      staticReservePct: { mid: 0, high: 0 },
      axes: { live: true, daily: true, monthly: true },
    },
    calibration: {
      mode: options.mode ?? "auto",
      intervalHours: 24,
      overlap: 0,
      maxShift: 1,
      minRatedModels: 9,
      minPerBand: 2,
      ...options.calibration,
    },
  };
  const getBandRange = vi.fn(
    (task: BandTask, band: "low" | "mid" | "high"): BandRange =>
      settings.tasks[task]?.[band] ?? calibrated[task]?.[band] ?? settings.bands[band]
  );
  const setCalibratedBandRanges = vi.fn((ranges: BandTaskOverrides | null) => {
    calibrated = ranges ? structuredClone(ranges) : {};
  });
  const getTaskFitnessWithSource = vi.fn((model: string, taskType: string): Rating => {
    const task = taskType === "coding" ? "coding" : "general";
    return options.ratings?.get(model)?.[task] ?? { score: 0.5, source: "wildcard_boost" };
  });
  const logInfo = vi.fn();
  const controller = createBandCalibrationController({
    getBandConfig: () => settings,
    getBandRange,
    getOperatorBandOverrides: () => settings.tasks,
    setCalibratedBandRanges,
    getTaskFitnessWithSource,
    getConfigPath: () => options.configPath ?? null,
    now: () => now,
    logInfo,
    logWarn: vi.fn(),
  });

  return {
    controller,
    settings,
    get calibrated() {
      return calibrated;
    },
    getBandRange,
    setCalibratedBandRanges,
    getTaskFitnessWithSource,
    logInfo,
    setNow(value: number) {
      now = value;
    },
  };
}

function ratingsFor(scores: readonly number[], source = "arena_elo"): Map<string, ModelRatings> {
  return new Map(
    scores.map((score, index) => [
      `model-${index}`,
      {
        general: { score, source },
        coding: { score, source },
      },
    ])
  );
}

async function observeAll(
  controller: ReturnType<typeof createBandCalibrationController>,
  modelIds: Iterable<string>
): Promise<void> {
  for (const model of modelIds) controller.observeModel(model);
  await controller.waitForIdle();
}

describe("automatic quality band calibration", () => {
  it("restores persisted ranges before the first band request builds its predicate", async () => {
    const directory = makeTempDirectory();
    const configPath = path.join(directory, "bands.json");
    const model = "first-request-restored-range";
    vi.stubEnv("OMNIROUTE_AUTO_BANDS", "1");
    vi.stubEnv("OMNIROUTE_AUTO_BANDS_CONFIG", configPath);
    writeFileSync(configPath, JSON.stringify({}));
    writeFileSync(
      path.join(directory, "auto-bands.state.json"),
      JSON.stringify({
        version: 1,
        updatedAt: 1_000,
        lastAttemptAt: 1_000,
        ranges: { general: { low: { min: 0, max: 0.2 } } },
      })
    );
    setUserFitnessOverride(model, "default", 0.4);

    const combo = await createVirtualAutoComboFromPrepared(
      {
        regularCandidates: [
          {
            provider: "openai",
            connectionId: "first-request-connection",
            allowedConnectionIds: ["first-request-connection"],
            model,
            modelStr: `openai/${model}`,
            costPer1MTokens: 1,
          },
        ],
        familyCandidates: [],
      },
      undefined,
      { category: "general_low" as never }
    );

    expect(combo.models).toEqual([]);
  });

  it("loads operator config before a cold calibration report captures its settings", async () => {
    const configPath = path.join(makeTempDirectory(), "bands.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        ratedSources: ["operator_rating"],
        capabilities: { so: { unknown: "allow" } },
      })
    );
    vi.stubEnv("OMNIROUTE_AUTO_BANDS_CONFIG", configPath);

    const config = await loadBandCalibrationReportConfig();

    expect(config.ratedSources).toEqual(["operator_rating"]);
    expect(config.capabilities.so.unknown).toBe("allow");
  });

  it("uses nearest-rank distinct score values, overlap, and recalculates both tasks", async () => {
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const harness = createHarness({ ratings, calibration: { maxShift: 1, overlap: 0.05 } });

    await observeAll(harness.controller, ratings.keys());

    expect(harness.calibrated.general).toEqual({
      low: { min: 0, max: 0.5700000000000001 },
      mid: { min: 0.47000000000000003, max: 0.79 },
      high: { min: 0.69, max: 1 },
    });
    expect(harness.calibrated.coding).toEqual(harness.calibrated.general);
  });

  it("deduplicates equal score values for cut points while counting rated model identities", async () => {
    const ratings = ratingsFor([0.2, 0.2, 0.2, 0.4, 0.4, 0.6, 0.8, 0.8, 1]);
    const harness = createHarness({ ratings, calibration: { maxShift: 1 } });

    await observeAll(harness.controller, ratings.keys());

    expect(harness.calibrated.general).toEqual({
      low: { min: 0, max: 0.4 },
      mid: { min: 0.4, max: 0.8 },
      high: { min: 0.8, max: 1 },
    });
    expect(harness.getTaskFitnessWithSource).toHaveBeenCalledTimes(18);
  });

  it("keeps a task's previous ranges when too few observed model identities are rated", async () => {
    const ratings = ratingsFor([0.2, 0.3, 0.4, 0.5, 0.6]);
    for (let index = 5; index < 9; index += 1) {
      ratings.set(`model-${index}`, {
        general: { score: 0.7, source: "wildcard_boost" },
        coding: { score: 0.7, source: "arena_elo" },
      });
    }
    const harness = createHarness({ ratings, calibration: { maxShift: 1 } });

    await observeAll(harness.controller, ratings.keys());

    expect(harness.calibrated.general).toBeUndefined();
    expect(harness.calibrated.coding).toBeDefined();
  });

  it("persists a guarded attempt so a restart respects the calibration interval", async () => {
    const directory = makeTempDirectory();
    const configPath = path.join(directory, "bands.json");
    const ratings = ratingsFor([0.2, 0.3, 0.4, 0.5, 0.6]);
    const first = createHarness({ ratings, configPath, calibration: { intervalHours: 1 } });

    await observeAll(first.controller, ratings.keys());

    const statePath = path.join(directory, "auto-bands.state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      updatedAt: number | null;
      lastAttemptAt: number;
      ranges: BandTaskOverrides;
    };
    expect(state.updatedAt).toBeNull();
    expect(state.lastAttemptAt).toBe(1_000_000);
    expect(state.ranges).toEqual({});

    const afterRestart = createHarness({
      ratings,
      configPath,
      calibration: { intervalHours: 1 },
      now: 1_000_001,
    });
    await observeAll(afterRestart.controller, ratings.keys());

    expect(afterRestart.getTaskFitnessWithSource).not.toHaveBeenCalled();
  });

  it("keeps the previous task ranges when any computed band is too thin", async () => {
    const ratings = ratingsFor([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    const harness = createHarness({ ratings, calibration: { maxShift: 1, minPerBand: 4 } });

    await observeAll(harness.controller, ratings.keys());

    expect(harness.calibrated.general).toBeUndefined();
    expect(harness.calibrated.coding).toBeUndefined();
  });

  it("counts unrated models admitted to low toward the minimum band population", async () => {
    const ratings = ratingsFor([0, 0.2, 0.2, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]);
    ratings.set("unrated-low", {
      general: { score: 0.5, source: "wildcard_boost" },
      coding: { score: 0.5, source: "wildcard_boost" },
    });
    const harness = createHarness({
      ratings,
      calibration: { maxShift: 1, minPerBand: 2 },
    });

    await observeAll(harness.controller, ratings.keys());

    expect(harness.calibrated.general?.low).toEqual({ min: 0, max: 0 });
    expect(harness.calibrated.coding?.low).toEqual({ min: 0, max: 0 });
  });

  it("clamps every boundary shift to maxShift", async () => {
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const harness = createHarness({ ratings, calibration: { maxShift: 0.05 } });

    await observeAll(harness.controller, ratings.keys());

    expect(harness.calibrated.general).toEqual({
      low: { min: 0, max: 0.52 },
      mid: { min: 0.5, max: 0.75 },
      high: { min: 0.74, max: 1 },
    });
  });

  it("logs actual pre-run and post-run ranges", async () => {
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const harness = createHarness({ ratings, calibration: { maxShift: 1 } });

    await observeAll(harness.controller, ratings.keys());

    const event = JSON.parse(harness.logInfo.mock.calls[0][0] as string) as {
      oldRanges: BandTaskOverrides;
      ranges: BandTaskOverrides;
    };
    expect(event.oldRanges.general?.low).toEqual({ min: 0, max: 0.55 });
    expect(event.ranges.general?.low).toEqual({ min: 0, max: 0.52 });
  });

  it("leaves per-task operator ranges effective over calibrated ranges", async () => {
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const tasks: BandTaskOverrides = { coding: { high: { min: 0.75, max: 1 } } };
    const harness = createHarness({ ratings, tasks, calibration: { maxShift: 1 } });

    await observeAll(harness.controller, ratings.keys());

    expect(harness.getBandRange("coding", "high")).toEqual({ min: 0.75, max: 1 });
    expect(harness.calibrated.coding?.high).toBeDefined();
  });

  it("does not recalculate in manual mode", async () => {
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const harness = createHarness({ ratings, mode: "manual" });

    await observeAll(harness.controller, ratings.keys());

    expect(harness.getTaskFitnessWithSource).not.toHaveBeenCalled();
    expect(harness.setCalibratedBandRanges).not.toHaveBeenCalled();
  });

  it("does not retain models observed while manual for a later auto run", async () => {
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const harness = createHarness({ ratings, mode: "manual", calibration: { maxShift: 1 } });

    await observeAll(harness.controller, ratings.keys());
    harness.settings.calibration.mode = "auto";
    harness.controller.observeModel("unrated-after-mode-change");
    await harness.controller.waitForIdle();

    expect(harness.getTaskFitnessWithSource).toHaveBeenCalledTimes(2);
    expect(harness.calibrated).toEqual({});
  });

  it("persists and restores calibrated ranges beside the config file", async () => {
    const directory = makeTempDirectory();
    const configPath = path.join(directory, "bands.json");
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const first = createHarness({ ratings, configPath, calibration: { maxShift: 1 } });

    await observeAll(first.controller, ratings.keys());

    const state = JSON.parse(
      readFileSync(path.join(directory, "auto-bands.state.json"), "utf8")
    ) as { ranges: BandTaskOverrides };
    const second = createHarness({ configPath, mode: "manual" });
    await second.controller.initialize();

    expect(second.calibrated).toEqual(state.ranges);
    expect(second.getTaskFitnessWithSource).not.toHaveBeenCalled();
  });

  it("keeps previous ranges and persists the interval after a failed run", async () => {
    const directory = makeTempDirectory();
    const configPath = path.join(directory, "bands.json");
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const calibration = { intervalHours: 1, maxShift: 1 };
    const first = createHarness({ ratings, configPath, calibration });
    await observeAll(first.controller, ratings.keys());
    const successfulState = JSON.parse(
      readFileSync(path.join(directory, "auto-bands.state.json"), "utf8")
    ) as { ranges: BandTaskOverrides; updatedAt: number };

    const failedAt = 1_000_000 + 60 * 60 * 1000;
    const failed = createHarness({ ratings, configPath, calibration, now: failedAt });
    failed.getTaskFitnessWithSource.mockImplementation(() => {
      throw new Error("fitness lookup failed");
    });
    await observeAll(failed.controller, ratings.keys());

    expect(failed.calibrated).toEqual(successfulState.ranges);
    const failedState = JSON.parse(
      readFileSync(path.join(directory, "auto-bands.state.json"), "utf8")
    ) as { ranges: BandTaskOverrides; updatedAt: number; lastAttemptAt: number };
    expect(failedState.ranges).toEqual(successfulState.ranges);
    expect(failedState.updatedAt).toBe(successfulState.updatedAt);
    expect(failedState.lastAttemptAt).toBe(failedAt);

    const afterRestart = createHarness({
      ratings,
      configPath,
      calibration,
      now: failedAt + 1,
    });
    await observeAll(afterRestart.controller, ratings.keys());
    expect(afterRestart.getTaskFitnessWithSource).not.toHaveBeenCalled();
  });

  it("shares one recalculation across concurrent triggers", async () => {
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const harness = createHarness({ ratings, calibration: { maxShift: 1 } });
    const modelIds = [...ratings.keys()];

    await Promise.all(
      modelIds.map((model) => Promise.resolve(harness.controller.observeModel(model)))
    );
    await harness.controller.waitForIdle();

    expect(harness.getTaskFitnessWithSource).toHaveBeenCalledTimes(18);
  });

  it("waits the configured interval before starting another run", async () => {
    const ratings = ratingsFor([0.4, 0.48, 0.52, 0.6, 0.68, 0.72, 0.74, 0.81, 0.92]);
    const harness = createHarness({ ratings, calibration: { intervalHours: 1, maxShift: 1 } });
    const modelIds = [...ratings.keys()];
    await observeAll(harness.controller, modelIds);
    const firstRunCallCount = harness.getTaskFitnessWithSource.mock.calls.length;

    harness.setNow(1_000_000 + 60 * 60 * 1000 - 1);
    await observeAll(harness.controller, modelIds);
    expect(harness.getTaskFitnessWithSource).toHaveBeenCalledTimes(firstRunCallCount);

    harness.setNow(1_000_000 + 60 * 60 * 1000);
    await observeAll(harness.controller, modelIds);
    expect(harness.getTaskFitnessWithSource.mock.calls.length).toBeGreaterThan(firstRunCallCount);
  });
});

describe("manual quality band calibration report", () => {
  it("reports rated-source coverage, unique score distribution, band counts, and capability cells", () => {
    const candidates: BandCalibrationReportCandidate[] = [
      {
        provider: "provider-a",
        model: "rated-low",
        fitness: {
          general: { score: 0.2, source: "arena_elo" },
          coding: { score: 0.2, source: "arena_elo" },
        },
        capabilities: {
          tools: { known: true, matches: true },
          so: { known: false, matches: false },
          reasoning: { known: false, matches: false },
          vision: { known: true, matches: false },
        },
      },
      {
        provider: "provider-a",
        model: "rated-mid",
        fitness: {
          general: { score: 0.5, source: "user_override" },
          coding: { score: 0.5, source: "user_override" },
        },
        capabilities: {
          tools: { known: true, matches: true },
          so: { known: true, matches: true },
          reasoning: { known: true, matches: true },
          vision: { known: false, matches: false },
        },
      },
      {
        provider: "provider-b",
        model: "unrated-high-score",
        fitness: {
          general: { score: 0.95, source: "wildcard_boost" },
          coding: { score: 0.95, source: "wildcard_boost" },
        },
        capabilities: {
          tools: { known: false, matches: false },
          so: { known: false, matches: false },
          reasoning: { known: false, matches: false },
          vision: { known: false, matches: false },
        },
      },
    ];
    const getBandRange = (_task: BandTask, band: "low" | "mid" | "high"): BandRange => {
      if (band === "low") return { min: 0, max: 0.3 };
      if (band === "mid") return { min: 0.4, max: 0.6 };
      return { min: 0.8, max: 1 };
    };

    const report = buildBandCalibrationReport(
      candidates,
      ["user_override", "arena_elo"],
      getBandRange
    );

    expect(report.tasks.general.ratedCount).toBe(2);
    expect(report.tasks.general.sourceCounts).toEqual({
      user_override: 1,
      arena_elo: 1,
      models_dev_tier: 0,
      fitness_table: 0,
      wildcard_boost: 1,
    });
    expect(report.tasks.general.sourceShares).toEqual({
      user_override: 1 / 3,
      arena_elo: 1 / 3,
      models_dev_tier: 0,
      fitness_table: 0,
      wildcard_boost: 1 / 3,
    });
    expect(report.tasks.general.scoreDistribution).toEqual([
      { score: 0.2, modelCount: 1 },
      { score: 0.5, modelCount: 1 },
    ]);
    expect(report.tasks.general.bandCounts).toEqual({ low: 2, mid: 1, high: 0 });
    expect(report.capabilities.so.knownShare).toBeCloseTo(1 / 3);
    expect(report.capabilities.so.byTask.general.mid).toEqual({
      modelCount: 1,
      matchingCount: 1,
    });
  });
});

describe("band candidate observation hook", () => {
  it("records models evaluated by an enabled band filter", () => {
    vi.stubEnv("OMNIROUTE_AUTO_BANDS", "1");
    observeBandCandidateMock.mockReset();
    const check = buildBandCheck("general_low");

    expect(check?.({ provider: "provider-a", model: "model-observed" })).toBe(true);
    expect(observeBandCandidateMock).toHaveBeenCalledWith("model-observed");
  });
});
