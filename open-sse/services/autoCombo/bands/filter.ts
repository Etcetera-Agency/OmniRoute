import { getBandConfig, getBandRange, type BandRange } from "./config";
import { getTaskFitnessWithSource } from "../taskFitness";
import type { BandTask, QualityBand } from "./grammar";

export interface QualityBandCandidate {
  model: string;
}

export type QualityBandCheck = (candidate: QualityBandCandidate) => boolean;

export interface QualityBandFilterDependencies {
  getBandRange(task: BandTask, band: QualityBand): BandRange;
  getRatedSources(): readonly string[];
  getTaskFitnessWithSource(
    model: string,
    taskType: string,
    profile: "low" | "medium" | "high"
  ): { score: number; source: string };
  allowModelsDevTier?: boolean;
  allowBenchmarkFitness?: boolean;
  allowBenchmarkConsensus?: boolean;
}

type QualityBandFilterOverrides = Partial<QualityBandFilterDependencies>;

function getConfiguredRatedSources(): readonly string[] {
  return getBandConfig().ratedSources;
}

// AICODE-NOTE: benchmark and models.dev scores count for free bands; static-table
// and wildcard scores stay unrated and available in low.
export function createQualityBandCheck(
  task: BandTask,
  band: QualityBand,
  overrides: QualityBandFilterOverrides = {}
): QualityBandCheck {
  const resolveRange = overrides.getBandRange ?? getBandRange;
  const resolveRatedSources = overrides.getRatedSources ?? getConfiguredRatedSources;
  const resolveFitness = overrides.getTaskFitnessWithSource ?? getTaskFitnessWithSource;
  const { min, max } = resolveRange(task, band);
  const ratedSources = resolveRatedSources();
  const taskType = task === "general" ? "default" : "coding";
  const profile = band === "mid" ? "medium" : band;

  return (candidate) => {
    try {
      const { score, source } = resolveFitness(candidate.model, taskType, profile);
      const isModelsDevTier = source === "models_dev_tier" || source.startsWith("models_dev_tier:");
      const isBenchmarkConsensus =
        source === "benchmark_consensus" || source.startsWith("benchmark_consensus:");
      const isBenchmarkFitness =
        source === "benchmark_fitness" || source.startsWith("benchmark_fitness:");
      let isRated: boolean;
      if (isModelsDevTier) {
        isRated = overrides.allowModelsDevTier === true;
      } else if (isBenchmarkFitness) {
        isRated = overrides.allowBenchmarkFitness === true;
      } else if (isBenchmarkConsensus) {
        isRated = overrides.allowBenchmarkConsensus === true;
      } else {
        isRated = ratedSources.some(
          (ratedSource) => source === ratedSource || source.startsWith(`${ratedSource}:`)
        );
      }
      if (!isRated) return band === "low";
      return score >= min && score <= max;
    } catch {
      return false;
    }
  };
}
