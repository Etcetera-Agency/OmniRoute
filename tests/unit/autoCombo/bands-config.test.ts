import { chmodSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBandConfig,
  getBandRange,
  getOperatorBandOverrides,
  setCalibratedBandRanges,
} from "../../../open-sse/services/autoCombo/bands/config";

const DEFAULT_RANGES = {
  low: { min: 0, max: 0.55 },
  mid: { min: 0.45, max: 0.8 },
  high: { min: 0.7, max: 1 },
};

const DEFAULT_RESERVE = {
  enabled: false,
  lookbackDays: 7,
  refreshMinutes: 10,
  maxAgeMinutes: 60,
  maxSnapshotAgeMinutes: 30,
  floorPct: 10,
  staticReservePct: { mid: 0, high: 0 },
  axes: { live: true, daily: true, monthly: true },
};

const originalConfigPath = process.env.OMNIROUTE_AUTO_BANDS_CONFIG;
const temporaryDirectories: string[] = [];

function makeConfigPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniroute-bands-config-"));
  temporaryDirectories.push(directory);
  return join(directory, "bands.json");
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

afterEach(() => {
  if (originalConfigPath === undefined) {
    delete process.env.OMNIROUTE_AUTO_BANDS_CONFIG;
  } else {
    process.env.OMNIROUTE_AUTO_BANDS_CONFIG = originalConfigPath;
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }

  setCalibratedBandRanges(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("auto quality band configuration", () => {
  it("uses the documented built-in ranges and defaults", () => {
    delete process.env.OMNIROUTE_AUTO_BANDS_CONFIG;

    const config = getBandConfig();

    expect(config.bands).toEqual(DEFAULT_RANGES);
    expect(getBandRange("general", "low")).toEqual(DEFAULT_RANGES.low);
    expect(config.ratedSources).toEqual(["user_override", "arena_elo"]);
    expect(config.capabilities.so.unknown).toBe("deny");
    expect(config.reserve).toEqual(DEFAULT_RESERVE);
    expect(config.calibration).toEqual({
      mode: "manual",
      intervalHours: 24,
      overlap: 0.05,
      maxShift: 0.05,
      minRatedModels: 9,
      minPerBand: 2,
    });
  });

  it("loads global settings and keeps per-task ranges as explicit overrides", async () => {
    const path = makeConfigPath();
    writeFileSync(
      path,
      JSON.stringify({
        bands: { high: { min: 0.72, max: 0.98 } },
        tasks: { coding: { high: { min: 0.75, max: 1 } } },
        ratedSources: ["user_override", "arena_elo", "models_dev_tier"],
        capabilities: { so: { unknown: "allow" } },
        calibration: { mode: "auto", intervalHours: 12 },
        reserve: {
          enabled: true,
          floorPct: 15,
          staticReservePct: { high: 12 },
          axes: { monthly: false },
        },
      })
    );
    process.env.OMNIROUTE_AUTO_BANDS_CONFIG = path;

    const coldConfig = getBandConfig();
    expect(coldConfig.bands).toEqual(DEFAULT_RANGES);

    await waitFor(() => {
      expect(getBandConfig().bands.high).toEqual({ min: 0.72, max: 0.98 });
    });

    expect(getBandRange("general", "high")).toEqual({ min: 0.72, max: 0.98 });
    expect(getBandRange("coding", "high")).toEqual({ min: 0.75, max: 1 });
    expect(getBandConfig().ratedSources).toEqual(["user_override", "arena_elo", "models_dev_tier"]);
    expect(getBandConfig().capabilities.so.unknown).toBe("allow");
    expect(getBandConfig().calibration).toEqual({
      mode: "auto",
      intervalHours: 12,
      overlap: 0.05,
      maxShift: 0.05,
      minRatedModels: 9,
      minPerBand: 2,
    });
    expect(getBandConfig().reserve).toEqual({
      ...DEFAULT_RESERVE,
      enabled: true,
      floorPct: 15,
      staticReservePct: { mid: 0, high: 12 },
      axes: { live: true, daily: true, monthly: false },
    });
  });

  it("uses newly written file settings after its mtime changes", async () => {
    const path = makeConfigPath();
    writeFileSync(path, JSON.stringify({ bands: { high: { min: 0.72, max: 1 } } }));
    process.env.OMNIROUTE_AUTO_BANDS_CONFIG = path;

    await waitFor(() => {
      expect(getBandConfig().bands.high.min).toBe(0.72);
    });

    writeFileSync(path, JSON.stringify({ bands: { high: { min: 0.8, max: 1 } } }));
    const updatedTime = new Date(Date.now() + 2_000);
    utimesSync(path, updatedTime, updatedTime);
    vi.setSystemTime(new Date(Date.now() + 31_000));

    getBandConfig();
    await waitFor(() => {
      expect(getBandConfig().bands.high.min).toBe(0.8);
    });
  });

  it("falls back to defaults and warns once for an invalid range", async () => {
    const path = makeConfigPath();
    writeFileSync(path, JSON.stringify({ bands: { high: { min: 0.9, max: 0.8 } } }));
    process.env.OMNIROUTE_AUTO_BANDS_CONFIG = path;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    getBandConfig();
    await waitFor(() => expect(warning).toHaveBeenCalledTimes(1));

    expect(getBandConfig().bands).toEqual(DEFAULT_RANGES);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      getBandConfig();
    }
    expect(warning).toHaveBeenCalledTimes(1);

    const changedMtime = new Date(Date.now() + 2_000);
    utimesSync(path, changedMtime, changedMtime);
    vi.setSystemTime(new Date(Date.now() + 31_000));
    getBandConfig();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["non-boolean enabled", { enabled: "true" }],
    ["zero refresh interval", { refreshMinutes: 0 }],
    ["negative lookback", { lookbackDays: -1 }],
    ["floor above 100 percent", { floorPct: 101 }],
    ["negative static reserve", { staticReservePct: { high: -1 } }],
    ["non-boolean axis", { axes: { daily: 1 } }],
  ])("falls back to defaults for invalid reserve config: %s", async (_name, reserve) => {
    const path = makeConfigPath();
    writeFileSync(path, JSON.stringify({ reserve }));
    process.env.OMNIROUTE_AUTO_BANDS_CONFIG = path;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    getBandConfig();
    await waitFor(() => expect(warning).toHaveBeenCalledTimes(1));

    expect(getBandConfig().reserve).toEqual(DEFAULT_RESERVE);
  });

  it("retries a transient read failure after permissions recover with unchanged mtime", async () => {
    const path = makeConfigPath();
    writeFileSync(path, JSON.stringify({ bands: { high: { min: 0.91, max: 1 } } }));
    const fixedTime = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(path, fixedTime, fixedTime);
    const originalMtime = statSync(path).mtimeMs;
    chmodSync(path, 0o000);
    process.env.OMNIROUTE_AUTO_BANDS_CONFIG = path;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    getBandConfig();
    await waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
    expect(getBandConfig().bands.high.min).toBe(0.7);

    chmodSync(path, 0o644);
    expect(statSync(path).mtimeMs).toBe(originalMtime);
    vi.setSystemTime(new Date(Date.now() + 31_000));

    getBandConfig();
    await waitFor(() => expect(getBandConfig().bands.high.min).toBe(0.91));
  });

  it("quietly uses defaults when the configured file is missing", async () => {
    process.env.OMNIROUTE_AUTO_BANDS_CONFIG = makeConfigPath();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    getBandConfig();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(getBandConfig().bands).toEqual(DEFAULT_RANGES);
    expect(warning).not.toHaveBeenCalled();
  });

  it("resolves task pins before calibrated ranges and global bands", async () => {
    const path = makeConfigPath();
    writeFileSync(
      path,
      JSON.stringify({
        bands: { high: { min: 0.72, max: 0.98 } },
        tasks: { coding: { high: { min: 0.75, max: 1 } } },
      })
    );
    process.env.OMNIROUTE_AUTO_BANDS_CONFIG = path;
    getBandConfig();
    setCalibratedBandRanges({
      general: { high: { min: 0.82, max: 0.9 } },
      coding: { high: { min: 0.8, max: 0.95 } },
    });

    await waitFor(() => {
      expect(getOperatorBandOverrides()).toEqual({
        coding: { high: { min: 0.75, max: 1 } },
      });
    });
    expect(getBandRange("general", "high")).toEqual({ min: 0.82, max: 0.9 });
    expect(getBandRange("coding", "high")).toEqual({ min: 0.75, max: 1 });
  });
});
