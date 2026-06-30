import { calculateFmoRequestCapacityPerDay } from "./capacity";
import { resolveFmoBand, type FmoIntelligenceDeps } from "./intelligence";
import { buildFmoHeadInventory, defaultFmoInventoryDeps, type FmoInventoryDeps } from "./inventory";
import { resolveFmoQuota, type FmoQuotaDeps } from "./quota";
import type { FmoSolveCandidate } from "./packing";
import type { FmoPlanningPool } from "./types";

export interface FmoSolveCandidateDeps {
  inventory?: FmoInventoryDeps;
  intelligence?: FmoIntelligenceDeps;
  quota?: FmoQuotaDeps;
}

function quotaTierWeight(tier: 1 | 2 | 3 | 4): number {
  return 1 - (tier - 1) * 0.2;
}

function capacityScore(capacity: number | null, demand: number): number {
  if (capacity === null || demand <= 0) return 0;
  return Math.min(1, capacity / demand);
}

function combinedScore(score: number | null, tier: 1 | 2 | 3 | 4, capacity: number | null): number {
  return (score ?? 0) + quotaTierWeight(tier) + capacityScore(capacity, 100);
}

function bestScore(values: Record<string, number>): number {
  return Math.max(0, ...Object.values(values));
}

export async function buildFmoSolveCandidates(
  pools: FmoPlanningPool[],
  deps: FmoSolveCandidateDeps = {}
): Promise<FmoSolveCandidate[]> {
  const inventory = await buildFmoHeadInventory(deps.inventory ?? defaultFmoInventoryDeps);
  const candidates: FmoSolveCandidate[] = [];

  for (const head of inventory) {
    const quota = await resolveFmoQuota(head, deps.quota);
    const qualityScoreByComboId: Record<string, number | null> = {};
    const capacityPerDayByComboId: Record<string, number | null> = {};
    const scoreByComboId: Record<string, number> = {};

    for (const pool of pools) {
      const band = resolveFmoBand(head, pool.constraints.quality_band, deps.intelligence);
      const capacity = calculateFmoRequestCapacityPerDay(quota.axes, pool);
      qualityScoreByComboId[pool.combo_id] = band.score;
      capacityPerDayByComboId[pool.combo_id] = capacity;
      scoreByComboId[pool.combo_id] = combinedScore(
        band.score,
        quota.tier,
        capacity ?? pool.demand.requests_per_day
      );
    }

    candidates.push({
      providerId: head.providerId,
      connectionId: head.connectionId,
      modelId: head.modelId,
      capabilities: head.capabilities,
      contextWindow: head.contextWindow,
      isFree: head.freeModel !== null,
      qualityScore: qualityScoreByComboId[pools[0]?.combo_id] ?? null,
      qualityScoreByComboId,
      quotaTier: quota.tier,
      capacityPerDay: capacityPerDayByComboId[pools[0]?.combo_id] ?? null,
      capacityPerDayByComboId,
      score: bestScore(scoreByComboId),
      scoreByComboId,
      degraded: false,
    });
  }

  return candidates;
}
