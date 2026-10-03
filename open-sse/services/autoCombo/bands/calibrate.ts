import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getBandConfig,
  getBandRange,
  getOperatorBandOverrides,
  loadBandConfig,
  setCalibratedBandRanges,
  type BandConfig,
  type BandRange,
  type BandTask,
  type BandTaskOverrides,
} from "./config";
import { getTaskFitnessWithSource } from "../taskFitness";
import type { BandCapability, QualityBand as Band } from "./grammar";

const TASKS: readonly BandTask[] = ["general", "coding"];
const BANDS: readonly Band[] = ["low", "mid", "high"];
const CAPABILITIES: readonly BandCapability[] = ["tools", "so", "reasoning", "vision"];
const KNOWN_SOURCE_LABELS = [
  "user_override",
  "arena_elo",
  "models_dev_tier",
  "fitness_table",
  "wildcard_boost",
] as const;
const STATE_FILE_NAME = "auto-bands.state.json";

type Fitness = { score: number; source: string };

interface BandCalibrationState {
  version: 1;
  updatedAt: number | null;
  lastAttemptAt: number;
  ranges: BandTaskOverrides;
}

export interface BandCalibrationDependencies {
  getBandConfig(): BandConfig;
  getBandRange(task: BandTask, band: Band): BandRange;
  getOperatorBandOverrides(): BandTaskOverrides;
  setCalibratedBandRanges(ranges: BandTaskOverrides | null): void;
  getTaskFitnessWithSource(model: string, taskType: string): Fitness;
  getConfigPath(): string | null;
  now(): number;
  logInfo(message: string): void;
  logWarn(message: string): void;
}

export interface BandCalibrationController {
  initialize(): Promise<void>;
  observeModel(model: string): void;
  waitForIdle(): Promise<void>;
}

export interface BandCalibrationReportCandidate {
  provider: string;
  model: string;
  fitness: Record<BandTask, Fitness>;
  capabilities: Record<BandCapability, { known: boolean; matches: boolean }>;
}

interface BandCalibrationTaskReport {
  modelCount: number;
  ratedCount: number;
  ratedShare: number;
  sourceCounts: Record<string, number>;
  sourceShares: Record<string, number>;
  scoreDistribution: Array<{ score: number; modelCount: number }>;
  cutPoints: { c1: number; c2: number } | null;
  bandCounts: Record<Band, number>;
}

interface BandCalibrationCapabilityCell {
  modelCount: number;
  matchingCount: number;
}

interface BandCalibrationCapabilityReport {
  modelCount: number;
  knownCount: number;
  unknownCount: number;
  knownShare: number;
  unknownShare: number;
  byTask: Record<BandTask, Record<Band, BandCalibrationCapabilityCell>>;
}

export interface BandCalibrationReport {
  modelCount: number;
  candidateCount: number;
  tasks: Record<BandTask, BandCalibrationTaskReport>;
  capabilities: Record<BandCapability, BandCalibrationCapabilityReport>;
}

function createDefaultDependencies(): BandCalibrationDependencies {
  return {
    getBandConfig,
    getBandRange,
    getOperatorBandOverrides,
    setCalibratedBandRanges,
    getTaskFitnessWithSource,
    getConfigPath() {
      const value = process.env.OMNIROUTE_AUTO_BANDS_CONFIG?.trim();
      return value || null;
    },
    now: Date.now,
    logInfo: console.info,
    logWarn: console.warn,
  };
}

function mergeDependencies(
  overrides: Partial<BandCalibrationDependencies>
): BandCalibrationDependencies {
  return { ...createDefaultDependencies(), ...overrides };
}

function isRatedSource(source: string, ratedSources: readonly string[]): boolean {
  return ratedSources.some((ratedSource) => source.startsWith(ratedSource));
}

function normalizeSource(source: string): string {
  return KNOWN_SOURCE_LABELS.find((label) => source.startsWith(label)) ?? source;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneRanges(ranges: BandTaskOverrides): BandTaskOverrides {
  const result: BandTaskOverrides = {};
  for (const task of TASKS) {
    const taskRanges = ranges[task];
    if (!taskRanges) continue;
    result[task] = {};
    for (const band of BANDS) {
      const range = taskRanges[band];
      if (range) result[task][band] = { ...range };
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStateRanges(value: unknown): BandTaskOverrides | null {
  if (!isRecord(value)) return null;
  const ranges: BandTaskOverrides = {};

  for (const [taskKey, taskValue] of Object.entries(value)) {
    if (taskKey !== "general" && taskKey !== "coding") return null;
    if (!isRecord(taskValue)) return null;

    const task = taskKey as BandTask;
    ranges[task] = {};
    for (const [bandKey, rangeValue] of Object.entries(taskValue)) {
      if (bandKey !== "low" && bandKey !== "mid" && bandKey !== "high") return null;
      if (!isRecord(rangeValue)) return null;
      const { min, max } = rangeValue;
      if (
        typeof min !== "number" ||
        typeof max !== "number" ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        min < 0 ||
        max > 1 ||
        min > max
      ) {
        return null;
      }
      ranges[task][bandKey] = { min, max };
    }
  }

  return ranges;
}

function parseState(value: unknown): BandCalibrationState | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const updatedAt = value.updatedAt;
  const lastAttemptAt = value.lastAttemptAt;
  if (updatedAt !== null && typeof updatedAt !== "number") return null;
  if (typeof lastAttemptAt !== "number") return null;
  const parsedUpdatedAt = updatedAt as number | null;
  if (
    (parsedUpdatedAt !== null && (!Number.isFinite(parsedUpdatedAt) || parsedUpdatedAt < 0)) ||
    !Number.isFinite(lastAttemptAt) ||
    lastAttemptAt < 0
  ) {
    return null;
  }
  const ranges = parseStateRanges(value.ranges);
  if (!ranges) return null;
  return {
    version: 1,
    updatedAt: parsedUpdatedAt,
    lastAttemptAt,
    ranges,
  };
}

function statePathForConfig(configPath: string): string {
  return path.join(path.dirname(configPath), STATE_FILE_NAME);
}

async function writeStateAtomically(statePath: string, state: BandCalibrationState): Promise<void> {
  const directory = path.dirname(statePath);
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, statePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function nearestRankCutPoints(scores: readonly number[]): { c1: number; c2: number } | null {
  if (scores.length === 0) return null;
  // AICODE-NOTE: Distinct score values determine cutpoints; rated model identity
  // counts remain separate for the minimum-sample and per-band guards.
  const sortedScores = [...new Set(scores)].sort((left, right) => left - right);
  const count = sortedScores.length;
  const firstIndex = Math.ceil(0.33 * count) - 1;
  const secondIndex = Math.ceil(0.67 * count) - 1;
  return { c1: sortedScores[firstIndex], c2: sortedScores[secondIndex] };
}

function buildRanges(c1: number, c2: number, overlap: number): Record<Band, BandRange> {
  return {
    low: { min: 0, max: clamp(c1 + overlap, 0, 1) },
    mid: { min: clamp(c1 - overlap, 0, 1), max: clamp(c2 + overlap, 0, 1) },
    high: { min: clamp(c2 - overlap, 0, 1), max: 1 },
  };
}

function clampRangeShift(proposed: BandRange, previous: BandRange, maxShift: number): BandRange {
  const min = clamp(proposed.min, previous.min - maxShift, previous.min + maxShift);
  const max = clamp(proposed.max, previous.max - maxShift, previous.max + maxShift);
  return min <= max ? { min, max } : { ...previous };
}

function containsScore(range: BandRange, score: number): boolean {
  return score >= range.min && score <= range.max;
}

function countModelsInBand(
  ratedScores: ReadonlyMap<string, number>,
  unratedModelCount: number,
  band: Band,
  range: BandRange
): number {
  let count = band === "low" ? unratedModelCount : 0;
  for (const score of ratedScores.values()) {
    if (containsScore(range, score)) count += 1;
  }
  return count;
}

function serializeLog(event: Record<string, unknown>): string {
  return JSON.stringify({ component: "auto-bands-calibration", ...event });
}

/**
 * Builds the deferred recalibrator. Request-time calls only add model ids and queue
 * background work; fitness resolution and state-file I/O happen after that turn.
 */
export function createBandCalibrationController(
  overrides: Partial<BandCalibrationDependencies> = {}
): BandCalibrationController {
  const dependencies = mergeDependencies(overrides);
  // AICODE-NOTE: Keep only ids on the request path; task fitness and state I/O
  // are resolved by the queued worker after the current routing turn.
  const observedModels = new Map<string, number>();
  let appliedRanges: BandTaskOverrides = {};
  let lastSuccessfulAt: number | null = null;
  let lastAttemptAt: number | null = null;
  let initialized = false;
  let initializationPromise: Promise<void> | null = null;
  let backgroundWork: Promise<void> | null = null;

  async function loadState(): Promise<void> {
    const configuredPath = dependencies.getConfigPath();
    if (!configuredPath) return;

    const statePath = statePathForConfig(configuredPath);
    let content: string;
    try {
      content = await readFile(statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        dependencies.logWarn(
          serializeLog({ outcome: "state-read-failed", error: errorMessage(error) })
        );
      }
      return;
    }

    let parsed: BandCalibrationState | null = null;
    try {
      parsed = parseState(JSON.parse(content));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      dependencies.logWarn(serializeLog({ outcome: "invalid-state", statePath }));
      return;
    }

    appliedRanges = cloneRanges(parsed.ranges);
    lastSuccessfulAt = parsed.updatedAt;
    lastAttemptAt = parsed.lastAttemptAt;
    dependencies.setCalibratedBandRanges(appliedRanges);
  }

  async function persistState(state: BandCalibrationState): Promise<void> {
    const configuredPath = dependencies.getConfigPath();
    if (!configuredPath) return;
    await writeStateAtomically(statePathForConfig(configuredPath), state);
  }

  function ensureInitialized(): Promise<void> {
    if (initialized) return Promise.resolve();
    if (!initializationPromise) {
      initializationPromise = loadState()
        .catch((error) => {
          dependencies.logWarn(
            serializeLog({ outcome: "state-read-failed", error: errorMessage(error) })
          );
        })
        .finally(() => {
          initialized = true;
          initializationPromise = null;
        });
    }
    return initializationPromise;
  }

  function discardObservationsAndInitialize(): void {
    observedModels.clear();
    void ensureInitialized();
  }

  function scheduleBackgroundWork(): void {
    if (backgroundWork) return;
    backgroundWork = ensureInitialized()
      .then(() => runIfDue())
      .catch((error) => {
        dependencies.logWarn(serializeLog({ outcome: "failed", error: errorMessage(error) }));
      })
      .finally(() => {
        backgroundWork = null;
      });
  }

  async function runIfDue(): Promise<void> {
    const config = dependencies.getBandConfig();
    if (config.calibration.mode !== "auto") {
      observedModels.clear();
      return;
    }

    const now = dependencies.now();
    const intervalMs = config.calibration.intervalHours * 60 * 60 * 1000;
    if (lastAttemptAt !== null && now - lastAttemptAt < intervalMs) return;

    lastAttemptAt = now;
    for (const [model, observedAt] of observedModels) {
      if (now - observedAt > intervalMs) observedModels.delete(model);
    }
    const modelIds = [...observedModels.keys()];
    observedModels.clear();
    await recalibrate(modelIds, config, now);
  }

  async function recalibrate(
    modelIds: readonly string[],
    config: BandConfig,
    now: number
  ): Promise<void> {
    const taskUpdates: BandTaskOverrides = {};
    const outcomes: Record<string, string> = {};
    let oldRanges: BandTaskOverrides = {};

    try {
      oldRanges = previousRangeSummary(dependencies);
      for (const task of TASKS) {
        const taskType = task === "general" ? "default" : "coding";
        const ratedScores = new Map<string, number>();
        let unratedModelCount = 0;

        for (const model of modelIds) {
          const { score, source } = dependencies.getTaskFitnessWithSource(model, taskType);
          if (!isRatedSource(source, config.ratedSources)) {
            unratedModelCount += 1;
            continue;
          }
          if (!Number.isFinite(score) || score < 0 || score > 1) {
            throw new Error(`invalid rated fitness for ${task}: ${model}`);
          }
          ratedScores.set(model, score);
        }

        if (ratedScores.size < config.calibration.minRatedModels) {
          outcomes[task] = "too-few-rated-models";
          continue;
        }

        const cutPoints = nearestRankCutPoints([...ratedScores.values()]);
        if (!cutPoints) {
          outcomes[task] = "no-rated-scores";
          continue;
        }

        const rawRanges = buildRanges(cutPoints.c1, cutPoints.c2, config.calibration.overlap);
        const previousRanges = Object.fromEntries(
          BANDS.map((band) => [band, dependencies.getBandRange(task, band)])
        ) as Record<Band, BandRange>;
        const proposedRanges = Object.fromEntries(
          BANDS.map((band) => [
            band,
            clampRangeShift(rawRanges[band], previousRanges[band], config.calibration.maxShift),
          ])
        ) as Record<Band, BandRange>;
        const operatorOverrides = dependencies.getOperatorBandOverrides()[task] ?? {};
        const effectiveRanges = Object.fromEntries(
          BANDS.map((band) => [band, operatorOverrides[band] ?? proposedRanges[band]])
        ) as Record<Band, BandRange>;
        const thinBand = BANDS.find(
          (band) =>
            countModelsInBand(ratedScores, unratedModelCount, band, effectiveRanges[band]) <
            config.calibration.minPerBand
        );
        if (thinBand) {
          outcomes[task] = `thin-${thinBand}-band`;
          continue;
        }

        taskUpdates[task] = proposedRanges;
        outcomes[task] = "updated";
      }

      if (Object.keys(taskUpdates).length === 0) {
        await persistState({
          version: 1,
          updatedAt: lastSuccessfulAt,
          lastAttemptAt: now,
          ranges: appliedRanges,
        });
        dependencies.logInfo(
          serializeLog({
            outcome: "guarded",
            updatedAt: now,
            oldRanges,
            ranges: oldRanges,
            tasks: outcomes,
          })
        );
        return;
      }

      const nextRanges = cloneRanges(appliedRanges);
      for (const task of TASKS) {
        if (taskUpdates[task]) nextRanges[task] = taskUpdates[task];
      }

      await persistState({
        version: 1,
        updatedAt: now,
        lastAttemptAt: now,
        ranges: nextRanges,
      });

      dependencies.setCalibratedBandRanges(nextRanges);
      appliedRanges = cloneRanges(nextRanges);
      lastSuccessfulAt = now;
      const newRanges = previousRangeSummary(dependencies);
      dependencies.logInfo(
        serializeLog({
          outcome: "updated",
          updatedAt: now,
          oldRanges,
          ranges: newRanges,
          tasks: outcomes,
        })
      );
    } catch (error) {
      await persistState({
        version: 1,
        updatedAt: lastSuccessfulAt,
        lastAttemptAt: now,
        ranges: appliedRanges,
      }).catch(() => undefined);
      for (const model of modelIds) {
        if (!observedModels.has(model)) observedModels.set(model, now);
      }
      dependencies.logWarn(
        serializeLog({
          outcome: "failed",
          updatedAt: now,
          oldRanges,
          ranges: oldRanges,
          tasks: outcomes,
          error: errorMessage(error),
        })
      );
    }
  }

  function previousRangeSummary(deps: BandCalibrationDependencies): BandTaskOverrides {
    const result: BandTaskOverrides = {};
    for (const task of TASKS) {
      result[task] = {};
      for (const band of BANDS) result[task][band] = deps.getBandRange(task, band);
    }
    return result;
  }

  return {
    initialize: ensureInitialized,
    observeModel(model: string) {
      if (typeof model !== "string" || model.length === 0) return;
      let mode: BandConfig["calibration"]["mode"];
      try {
        mode = dependencies.getBandConfig().calibration.mode;
      } catch {
        discardObservationsAndInitialize();
        return;
      }
      if (mode !== "auto") {
        discardObservationsAndInitialize();
        return;
      }
      observedModels.set(model, dependencies.now());
      scheduleBackgroundWork();
    },
    async waitForIdle() {
      while (initializationPromise || backgroundWork) {
        await Promise.all([initializationPromise, backgroundWork].filter(Boolean));
      }
    },
  };
}

let bandCalibrationController: BandCalibrationController | null = null;
let bandCalibrationInitialization: Promise<void> | null = null;

/** Queue model observation and any due recalculation without blocking routing. */
export function observeBandCandidate(model: string): void {
  bandCalibrationController ??= createBandCalibrationController();
  bandCalibrationController.observeModel(model);
}

/** Load config and restore persisted ranges before an enabled predicate captures them. */
export async function initializeBandCalibration(): Promise<void> {
  if (!bandCalibrationInitialization) {
    bandCalibrationInitialization = (async () => {
      await loadBandConfig();
      bandCalibrationController ??= createBandCalibrationController();
      await bandCalibrationController.initialize();
    })();
  }
  await bandCalibrationInitialization;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceCountMap(): Record<string, number> {
  return Object.fromEntries(KNOWN_SOURCE_LABELS.map((source) => [source, 0]));
}

function uniqueCandidatesByProviderModel(
  candidates: readonly BandCalibrationReportCandidate[]
): BandCalibrationReportCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.provider}\0${candidate.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createEmptyTaskReport(): BandCalibrationTaskReport {
  return {
    modelCount: 0,
    ratedCount: 0,
    ratedShare: 0,
    sourceCounts: sourceCountMap(),
    sourceShares: sourceCountMap(),
    scoreDistribution: [],
    cutPoints: null,
    bandCounts: { low: 0, mid: 0, high: 0 },
  };
}

function createEmptyCapabilityReport(): BandCalibrationCapabilityReport {
  const byTask = {} as BandCalibrationCapabilityReport["byTask"];
  for (const task of TASKS) {
    byTask[task] = {
      low: { modelCount: 0, matchingCount: 0 },
      mid: { modelCount: 0, matchingCount: 0 },
      high: { modelCount: 0, matchingCount: 0 },
    };
  }
  return {
    modelCount: 0,
    knownCount: 0,
    unknownCount: 0,
    knownShare: 0,
    unknownShare: 0,
    byTask,
  };
}

/** Build report from model facts resolved by the local connected-catalog snapshot. */
export function buildBandCalibrationReport(
  inputCandidates: readonly BandCalibrationReportCandidate[],
  ratedSources: readonly string[],
  resolveRange: (task: BandTask, band: Band) => BandRange
): BandCalibrationReport {
  const candidates = uniqueCandidatesByProviderModel(inputCandidates);
  const modelsById = new Map<string, BandCalibrationReportCandidate>();
  for (const candidate of candidates) {
    if (!modelsById.has(candidate.model)) modelsById.set(candidate.model, candidate);
  }

  const tasks = {} as BandCalibrationReport["tasks"];
  for (const task of TASKS) {
    const taskReport = createEmptyTaskReport();
    const ratedScores = new Map<string, number>();
    taskReport.modelCount = modelsById.size;

    for (const [model, candidate] of modelsById) {
      const fitness = candidate.fitness[task];
      const source = normalizeSource(fitness.source);
      taskReport.sourceCounts[source] = (taskReport.sourceCounts[source] ?? 0) + 1;
      if (!isRatedSource(fitness.source, ratedSources)) continue;
      if (!Number.isFinite(fitness.score) || fitness.score < 0 || fitness.score > 1) continue;
      ratedScores.set(model, fitness.score);
    }

    taskReport.ratedCount = ratedScores.size;
    taskReport.ratedShare = modelsById.size === 0 ? 0 : ratedScores.size / modelsById.size;
    if (modelsById.size > 0) {
      for (const [source, count] of Object.entries(taskReport.sourceCounts)) {
        taskReport.sourceShares[source] = count / modelsById.size;
      }
    }
    const distribution = new Map<number, number>();
    for (const score of ratedScores.values()) {
      distribution.set(score, (distribution.get(score) ?? 0) + 1);
    }
    taskReport.scoreDistribution = [...distribution]
      .sort(([left], [right]) => left - right)
      .map(([score, modelCount]) => ({ score, modelCount }));
    taskReport.cutPoints = nearestRankCutPoints([...ratedScores.values()]);

    for (const band of BANDS) {
      const range = resolveRange(task, band);
      let count = 0;
      for (const candidate of modelsById.values()) {
        const fitness = candidate.fitness[task];
        const rated = isRatedSource(fitness.source, ratedSources);
        if (rated ? containsScore(range, fitness.score) : band === "low") count += 1;
      }
      taskReport.bandCounts[band] = count;
    }
    tasks[task] = taskReport;
  }

  const capabilities = {} as BandCalibrationReport["capabilities"];
  for (const capability of CAPABILITIES) {
    const capabilityReport = createEmptyCapabilityReport();
    capabilityReport.modelCount = candidates.length;
    for (const candidate of candidates) {
      const fact = candidate.capabilities[capability];
      if (fact.known) capabilityReport.knownCount += 1;
      else capabilityReport.unknownCount += 1;

      for (const task of TASKS) {
        const fitness = candidate.fitness[task];
        const rated = isRatedSource(fitness.source, ratedSources);
        for (const band of BANDS) {
          const inBand = rated
            ? containsScore(resolveRange(task, band), fitness.score)
            : band === "low";
          if (!inBand) continue;
          const cell = capabilityReport.byTask[task][band];
          cell.modelCount += 1;
          if (fact.matches) cell.matchingCount += 1;
        }
      }
    }
    if (capabilityReport.modelCount > 0) {
      capabilityReport.knownShare = capabilityReport.knownCount / capabilityReport.modelCount;
      capabilityReport.unknownShare = capabilityReport.unknownCount / capabilityReport.modelCount;
    }
    capabilities[capability] = capabilityReport;
  }

  return {
    modelCount: modelsById.size,
    candidateCount: candidates.length,
    tasks,
    capabilities,
  };
}
