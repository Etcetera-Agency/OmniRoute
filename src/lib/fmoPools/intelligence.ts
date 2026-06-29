import { getResolvedTaskFitness } from "@/lib/db/modelIntelligence";
import type { FmoHeadCandidate } from "./types";

export interface FmoQualityBand {
  category: string;
  min: number;
  max: number;
  relax?: number;
}

export interface FmoBandResolution {
  score: number | null;
  inBand: boolean;
  relaxed: boolean;
  headEligible: boolean;
}

export interface FmoIntelligenceDeps {
  getResolvedTaskFitness(model: string, category: string): number | null;
}

export const defaultFmoIntelligenceDeps: FmoIntelligenceDeps = {
  getResolvedTaskFitness,
};

function modelLookupKeys(candidate: Pick<FmoHeadCandidate, "providerId" | "modelId">): string[] {
  return [candidate.modelId, `${candidate.providerId}/${candidate.modelId}`];
}

export function resolveFmoBand(
  candidate: Pick<FmoHeadCandidate, "providerId" | "modelId">,
  band: FmoQualityBand,
  deps: FmoIntelligenceDeps = defaultFmoIntelligenceDeps
): FmoBandResolution {
  let score: number | null = null;
  for (const key of modelLookupKeys(candidate)) {
    score = deps.getResolvedTaskFitness(key, band.category);
    if (score !== null) break;
  }

  if (score === null) {
    return { score, inBand: false, relaxed: false, headEligible: false };
  }

  const inBand = score >= band.min && score <= band.max;
  const relax = band.relax ?? 0;
  const relaxed = !inBand && score >= band.min - relax && score <= band.max + relax;

  return { score, inBand, relaxed, headEligible: inBand || relaxed };
}
