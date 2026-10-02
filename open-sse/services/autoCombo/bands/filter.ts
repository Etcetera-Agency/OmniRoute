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
}

type QualityBandFilterOverrides = Partial<QualityBandFilterDependencies>;

function getConfiguredRatedSources(): readonly string[] {
  return getBandConfig().ratedSources;
}

// AICODE-NOTE: Upstream `:inherited` source suffixes remain rated by prefix.
// Tier, static-table, and wildcard scores are unmeasured and stay available in low only.
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
      const isRated = ratedSources.some((ratedSource) => source.startsWith(ratedSource));
      if (!isRated) return band === "low";
      return score >= min && score <= max;
    } catch {
      return false;
    }
  };
}
