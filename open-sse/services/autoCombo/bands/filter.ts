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
  getTaskFitnessWithSource(model: string, taskType: string): { score: number; source: string };
  allowModelsDevTier?: boolean;
}

type QualityBandFilterOverrides = Partial<QualityBandFilterDependencies>;

function getConfiguredRatedSources(): readonly string[] {
  return getBandConfig().ratedSources;
}

// AICODE-NOTE: models.dev scores count only for free coding-high; other tier,
// static-table, and wildcard scores remain unmeasured and stay available in low.
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

  return (candidate) => {
    try {
      const { score, source } = resolveFitness(candidate.model, taskType);
      const isModelsDevTier =
        overrides.allowModelsDevTier === true &&
        task === "coding" &&
        band === "high" &&
        (source === "models_dev_tier" || source.startsWith("models_dev_tier:"));
      const isRated =
        ratedSources.some((ratedSource) => source.startsWith(ratedSource)) || isModelsDevTier;
      if (!isRated) return band === "low";
      return score >= min && score <= max;
    } catch {
      return false;
    }
  };
}
