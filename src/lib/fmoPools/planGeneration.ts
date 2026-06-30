import { getDbInstance } from "@/lib/db/core";
import { listFmoPlanningPools, getFmoPoolGenerationMarker } from "@/lib/db/fmoPools";
import { buildFmoSolveCandidates, type FmoSolveCandidateDeps } from "./candidates";
import { solveFmoPools, type FmoIncumbencyPrior } from "./packing";
import type { FmoRebalancePlan } from "./rebalance";
import type { FmoTailConfig } from "./tail";
import { readFmoTailConfig } from "./tailConfig";

export interface FmoGenerationPlanDeps extends FmoSolveCandidateDeps {
  readTailConfig?: () => FmoTailConfig;
}

type DecisionRow = {
  combo_id: string;
  provider_id: string;
  model_id: string;
  connection_id: string | null;
};

export function loadIncumbencyPrior(generation: string | null): FmoIncumbencyPrior {
  if (!generation) return { byComboId: {} };

  const db = getDbInstance();
  const rows = db
    .prepare(
      [
        "SELECT combo_id, provider_id, model_id, connection_id",
        "FROM fmo_pool_decisions",
        "WHERE generation = ? AND role = 'head' AND outcome = 'seated'",
        "ORDER BY id ASC",
      ].join(" ")
    )
    .all(generation) as DecisionRow[];

  const byComboId: FmoIncumbencyPrior["byComboId"] = {};
  for (const row of rows) {
    byComboId[row.combo_id] ??= [];
    byComboId[row.combo_id].push({
      providerId: row.provider_id,
      modelId: row.model_id,
      connectionId: row.connection_id,
    });
  }

  return { byComboId };
}

export async function buildFmoGenerationPlan(
  deps: FmoGenerationPlanDeps = {}
): Promise<FmoRebalancePlan> {
  // AICODE-NOTE: Production FMO rebalance enters here; do not reintroduce empty plan synthesis.
  const marker = getFmoPoolGenerationMarker();
  if (!marker) throw new Error("No accepted FMO pool generation");

  const pools = listFmoPlanningPools();
  const priorGeneration = getFmoAppliedGenerationValue();
  const prior = loadIncumbencyPrior(priorGeneration);
  const candidates = await buildFmoSolveCandidates(pools, deps);
  const { plans, decisions } = solveFmoPools(pools, candidates, {
    prior,
    tailConfig: (deps.readTailConfig ?? readFmoTailConfig)(),
  });

  for (const pool of pools) {
    const hasHead = plans[pool.combo_id]?.some((member) => member.role === "head");
    if (hasHead) continue;
    decisions.push({
      comboId: pool.combo_id,
      providerId: "none",
      modelId: "none",
      connectionId: null,
      role: "head",
      outcome: "dropped",
      reason: "empty-head-tail-only",
    });
  }

  return { generation: marker.generation, plans, decisions };
}

function getFmoAppliedGenerationValue(): string | null {
  const db = getDbInstance();
  const row = db.prepare("SELECT generation FROM fmo_pool_apply_marker WHERE id = 1").get() as
    | { generation?: string }
    | undefined;
  return row?.generation ?? null;
}
