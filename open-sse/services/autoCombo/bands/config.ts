import { stat, readFile } from "node:fs/promises";

export type BandTask = "general" | "coding";
export type Band = "low" | "mid" | "high";
export type BandRange = { min: number; max: number };
export type BandRanges = Record<Band, BandRange>;
export type BandTaskOverrides = Partial<Record<BandTask, Partial<Record<Band, BandRange>>>>;
export type CalibratedBandRanges = BandTaskOverrides;

export interface BandReserveConfig {
  enabled: boolean;
  lookbackDays: number;
  refreshMinutes: number;
  maxAgeMinutes: number;
  maxSnapshotAgeMinutes: number;
  floorPct: number;
  staticReservePct: { mid: number; high: number };
  axes: { live: boolean; daily: boolean; monthly: boolean };
}

export interface BandConfig {
  bands: BandRanges;
  tasks: BandTaskOverrides;
  ratedSources: string[];
  capabilities: { so: { unknown: "allow" | "deny" } };
  reserve: BandReserveConfig;
  calibration: {
    mode: "manual" | "auto";
    intervalHours: number;
    overlap: number;
    maxShift: number;
    minRatedModels: number;
    minPerBand: number;
  };
}

const BUILT_IN_RANGES: BandRanges = {
  low: { min: 0, max: 0.55 },
  mid: { min: 0.45, max: 0.8 },
  high: { min: 0.7, max: 1 },
};

const BUILT_IN_RESERVE: BandReserveConfig = {
  enabled: false,
  lookbackDays: 7,
  refreshMinutes: 10,
  maxAgeMinutes: 60,
  maxSnapshotAgeMinutes: 30,
  floorPct: 10,
  staticReservePct: { mid: 0, high: 0 },
  axes: { live: true, daily: true, monthly: true },
};

const RELOAD_INTERVAL_MS = 30_000;

let configPath: string | null = null;
let cachedConfig = createDefaultConfig();
let cachedFileMtimeMs: number | null = null;
let lastFileCheckAt = 0;
let loadGeneration = 0;
let fileLoadPromise: Promise<void> | null = null;
let lastWarningSignature = "";
let calibratedRanges: CalibratedBandRanges = {};

function createDefaultConfig(): BandConfig {
  return {
    bands: cloneRanges(BUILT_IN_RANGES),
    tasks: {},
    ratedSources: ["user_override", "arena_elo"],
    capabilities: { so: { unknown: "deny" } },
    reserve: cloneReserveConfig(BUILT_IN_RESERVE),
    calibration: {
      mode: "manual",
      intervalHours: 24,
      overlap: 0.05,
      maxShift: 0.05,
      minRatedModels: 9,
      minPerBand: 2,
    },
  };
}

function cloneReserveConfig(config: BandReserveConfig): BandReserveConfig {
  return {
    ...config,
    staticReservePct: { ...config.staticReservePct },
    axes: { ...config.axes },
  };
}

function cloneRange(range: BandRange): BandRange {
  return { min: range.min, max: range.max };
}

function cloneRanges(ranges: BandRanges): BandRanges {
  return {
    low: cloneRange(ranges.low),
    mid: cloneRange(ranges.mid),
    high: cloneRange(ranges.high),
  };
}

function cloneOverrides(overrides: BandTaskOverrides): BandTaskOverrides {
  const copy: BandTaskOverrides = {};

  for (const task of ["general", "coding"] as const) {
    const taskRanges = overrides[task];
    if (!taskRanges) continue;

    copy[task] = {};
    for (const band of ["low", "mid", "high"] as const) {
      const range = taskRanges[band];
      if (range) copy[task][band] = cloneRange(range);
    }
  }

  return copy;
}

function cloneConfig(config: BandConfig): BandConfig {
  return {
    bands: cloneRanges(config.bands),
    tasks: cloneOverrides(config.tasks),
    ratedSources: [...config.ratedSources],
    capabilities: { so: { unknown: config.capabilities.so.unknown } },
    reserve: cloneReserveConfig(config.reserve),
    calibration: { ...config.calibration },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRange(value: unknown, name: string): BandRange {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  const { min, max } = value;
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min < 0 ||
    max > 1 ||
    min > max
  ) {
    throw new Error(`${name} must have finite 0..1 bounds with min <= max`);
  }

  return { min, max };
}

function assertFinitePositive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
  return value;
}

function assertPercentage(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be a finite percentage from 0 to 100`);
  }
  return value;
}

function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function parseReserveConfig(value: unknown): BandReserveConfig {
  if (!isRecord(value)) throw new Error("reserve must be an object");

  const reserve = cloneReserveConfig(BUILT_IN_RESERVE);
  if (value.enabled !== undefined) {
    reserve.enabled = assertBoolean(value.enabled, "reserve.enabled");
  }

  for (const key of [
    "lookbackDays",
    "refreshMinutes",
    "maxAgeMinutes",
    "maxSnapshotAgeMinutes",
  ] as const) {
    if (value[key] !== undefined) {
      reserve[key] = assertFinitePositive(value[key], `reserve.${key}`);
    }
  }

  if (value.floorPct !== undefined) {
    reserve.floorPct = assertPercentage(value.floorPct, "reserve.floorPct");
  }

  if (value.staticReservePct !== undefined) {
    if (!isRecord(value.staticReservePct)) {
      throw new Error("reserve.staticReservePct must be an object");
    }
    for (const [key, amount] of Object.entries(value.staticReservePct)) {
      if (key !== "mid" && key !== "high") {
        throw new Error(`reserve.staticReservePct.${key} is not a supported band`);
      }
      reserve.staticReservePct[key] = assertPercentage(amount, `reserve.staticReservePct.${key}`);
    }
  }

  if (value.axes !== undefined) {
    if (!isRecord(value.axes)) throw new Error("reserve.axes must be an object");
    for (const [key, enabled] of Object.entries(value.axes)) {
      if (key !== "live" && key !== "daily" && key !== "monthly") {
        throw new Error(`reserve.axes.${key} is not a supported axis`);
      }
      reserve.axes[key] = assertBoolean(enabled, `reserve.axes.${key}`);
    }
  }

  return reserve;
}

function parseRanges(value: unknown, name: string): Partial<BandRanges> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);

  const ranges: Partial<BandRanges> = {};
  for (const [key, range] of Object.entries(value)) {
    if (key !== "low" && key !== "mid" && key !== "high") {
      throw new Error(`${name}.${key} is not a supported band`);
    }
    ranges[key] = assertRange(range, `${name}.${key}`);
  }

  return ranges;
}

function parseTaskOverrides(value: unknown): BandTaskOverrides {
  if (!isRecord(value)) throw new Error("tasks must be an object");

  const tasks: BandTaskOverrides = {};
  for (const [key, ranges] of Object.entries(value)) {
    if (key !== "general" && key !== "coding") {
      throw new Error(`tasks.${key} is not a supported task`);
    }
    tasks[key] = parseRanges(ranges, `tasks.${key}`);
  }

  return tasks;
}

function parseConfig(value: unknown): BandConfig {
  if (!isRecord(value)) throw new Error("configuration must be an object");

  const config = createDefaultConfig();

  if (value.bands !== undefined) {
    config.bands = { ...config.bands, ...parseRanges(value.bands, "bands") };
  }

  if (value.tasks !== undefined) {
    config.tasks = parseTaskOverrides(value.tasks);
  }

  if (value.ratedSources !== undefined) {
    if (
      !Array.isArray(value.ratedSources) ||
      value.ratedSources.some((source) => typeof source !== "string" || source.length === 0)
    ) {
      throw new Error("ratedSources must be an array of non-empty strings");
    }
    config.ratedSources = [...value.ratedSources];
  }

  if (value.capabilities !== undefined) {
    if (!isRecord(value.capabilities)) throw new Error("capabilities must be an object");
    if (value.capabilities.so !== undefined) {
      if (!isRecord(value.capabilities.so)) {
        throw new Error("capabilities.so must be an object");
      }
      if (value.capabilities.so.unknown !== undefined) {
        const unknown = value.capabilities.so.unknown;
        if (unknown !== "allow" && unknown !== "deny") {
          throw new Error('capabilities.so.unknown must be "allow" or "deny"');
        }
        config.capabilities.so.unknown = unknown;
      }
    }
  }

  if (value.reserve !== undefined) {
    config.reserve = parseReserveConfig(value.reserve);
  }

  if (value.calibration !== undefined) {
    if (!isRecord(value.calibration)) throw new Error("calibration must be an object");
    const calibration = { ...config.calibration };
    const input = value.calibration;

    if (input.mode !== undefined) {
      if (input.mode !== "manual" && input.mode !== "auto") {
        throw new Error('calibration.mode must be "manual" or "auto"');
      }
      calibration.mode = input.mode;
    }

    for (const key of ["intervalHours", "overlap", "maxShift"] as const) {
      if (input[key] === undefined) continue;
      if (typeof input[key] !== "number" || !Number.isFinite(input[key])) {
        throw new Error(`calibration.${key} must be a finite number`);
      }
      calibration[key] = input[key];
    }

    for (const key of ["minRatedModels", "minPerBand"] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`calibration.${key} must be an integer`);
      }
      calibration[key] = value;
    }

    if (
      calibration.intervalHours <= 0 ||
      calibration.overlap < 0 ||
      calibration.overlap > 1 ||
      calibration.maxShift < 0 ||
      calibration.maxShift > 1 ||
      calibration.minRatedModels < 1 ||
      calibration.minPerBand < 1
    ) {
      throw new Error("calibration values are outside their supported ranges");
    }
    config.calibration = calibration;
  }

  return config;
}

function getConfiguredPath(): string | null {
  const value = process.env.OMNIROUTE_AUTO_BANDS_CONFIG?.trim();
  return value ? value : null;
}

function switchConfigPath(nextPath: string | null): void {
  if (nextPath === configPath) return;

  configPath = nextPath;
  cachedConfig = createDefaultConfig();
  cachedFileMtimeMs = null;
  lastFileCheckAt = 0;
  lastWarningSignature = "";
  loadGeneration += 1;
}

async function refreshConfigFile(path: string, generation: number): Promise<void> {
  let fileMtimeMs: number;
  try {
    const fileStat = await stat(path);
    fileMtimeMs = fileStat.mtimeMs;
  } catch (error) {
    applyTransientFileFailure(path, error, generation);
    return;
  }

  if (generation !== loadGeneration || path !== configPath) return;
  if (cachedFileMtimeMs === fileMtimeMs) return;

  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    applyTransientFileFailure(path, error, generation);
    return;
  }

  let parsedConfig: BandConfig;
  try {
    parsedConfig = parseConfig(JSON.parse(content));
  } catch (error) {
    if (generation !== loadGeneration || path !== configPath) return;
    cachedConfig = createDefaultConfig();
    cachedFileMtimeMs = fileMtimeMs;
    warnConfigFileFailure(path, error);
    return;
  }

  if (generation !== loadGeneration || path !== configPath) return;
  cachedConfig = parsedConfig;
  cachedFileMtimeMs = fileMtimeMs;
  lastWarningSignature = "";
}

function applyTransientFileFailure(path: string, error: unknown, generation: number): void {
  if (generation !== loadGeneration || path !== configPath) return;

  cachedConfig = createDefaultConfig();
  if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
    cachedFileMtimeMs = null;
    lastWarningSignature = "";
    return;
  }

  // A read/stat failure may recover without an mtime change, so retry next interval.
  cachedFileMtimeMs = null;
  warnConfigFileFailure(path, error);
}

function warnConfigFileFailure(path: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const signature = `${path}:${message}`;
  if (signature === lastWarningSignature) return;

  console.warn(`[AUTO_BANDS] Failed to load ${path}: ${message}`);
  lastWarningSignature = signature;
}

function scheduleConfigRefresh(path: string): void {
  if (fileLoadPromise) return;

  lastFileCheckAt = Date.now();
  const generation = loadGeneration;
  fileLoadPromise = refreshConfigFile(path, generation).finally(() => {
    fileLoadPromise = null;
  });
}

// AICODE-NOTE: Band checks are on the request path; file reads stay in this background refresh.
export function getBandConfig(): BandConfig {
  const currentPath = getConfiguredPath();
  switchConfigPath(currentPath);

  if (currentPath && Date.now() - lastFileCheckAt >= RELOAD_INTERVAL_MS) {
    scheduleConfigRefresh(currentPath);
  }

  return cloneConfig(cachedConfig);
}

export function getOperatorBandOverrides(): BandTaskOverrides {
  return cloneOverrides(getBandConfig().tasks);
}

export function setCalibratedBandRanges(ranges: CalibratedBandRanges | null): void {
  if (ranges === null) {
    calibratedRanges = {};
    return;
  }

  calibratedRanges = parseTaskOverrides(ranges);
}

export function getBandRange(task: BandTask, band: Band): BandRange {
  const config = getBandConfig();
  const taskOverride = config.tasks[task]?.[band];
  if (taskOverride) return cloneRange(taskOverride);

  const calibrated = calibratedRanges[task]?.[band];
  if (calibrated) return cloneRange(calibrated);

  const globalRange = config.bands[band];
  return cloneRange(globalRange ?? BUILT_IN_RANGES[band]);
}
