import { getDbInstance } from "@/lib/db/core";
import { buildFmoGenerationPlan } from "./planGeneration";
import type { FmoDecisionRecord, FmoPlanMember } from "./packing";

export interface FmoRebalancePlan {
  generation: string;
  plans: Record<string, FmoPlanMember[]>;
  decisions: FmoDecisionRecord[];
}

export interface FmoShadowDiff {
  comboId: string;
  beforeModels: unknown[];
  afterModels: unknown[];
  changed: boolean;
}

export interface FmoRebalanceResult {
  generation: string;
  shadow: boolean;
  applied: boolean;
  diffs: FmoShadowDiff[];
}

export interface FmoRebalanceOptions {
  shadow?: boolean;
  planOverride?: FmoRebalancePlan;
}

export interface FmoRebalanceScheduler {
  start(): ReturnType<typeof setInterval> | null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseComboData(row: unknown): Record<string, unknown> | null {
  const data = toRecord(row).data;
  if (typeof data !== "string") return null;
  return JSON.parse(data) as Record<string, unknown>;
}

function listComboIds(plan: FmoRebalancePlan): string[] {
  return Object.keys(plan.plans);
}

function renderMember(member: FmoPlanMember, index: number): Record<string, unknown> {
  return {
    id: `fmo-${member.role}-${index + 1}-${member.providerId}-${member.modelId}`.replace(
      /[^a-zA-Z0-9_-]/g,
      "-"
    ),
    kind: "model",
    providerId: member.providerId,
    model: member.modelId,
    weight: 0,
    ...(member.connectionId ? { connectionId: member.connectionId } : {}),
  };
}

function renderModels(members: FmoPlanMember[]): Record<string, unknown>[] {
  return members.map(renderMember);
}

function assertCombosExist(comboIds: string[]): void {
  const db = getDbInstance();
  const lookup = db.prepare("SELECT id FROM combos WHERE id = ?");

  for (const comboId of comboIds) {
    if (!lookup.get(comboId)) {
      throw new Error(`FMO rebalance missing combo: ${comboId}`);
    }
  }
}

function getComboModels(comboId: string): unknown[] {
  const db = getDbInstance();
  const combo = parseComboData(db.prepare("SELECT data FROM combos WHERE id = ?").get(comboId));
  return Array.isArray(combo?.models) ? combo.models : [];
}

function diffPlan(plan: FmoRebalancePlan): FmoShadowDiff[] {
  return listComboIds(plan).map((comboId) => {
    const beforeModels = getComboModels(comboId);
    const afterModels = renderModels(plan.plans[comboId]);
    return {
      comboId,
      beforeModels,
      afterModels,
      changed: JSON.stringify(beforeModels) !== JSON.stringify(afterModels),
    };
  });
}

function applyPlan(plan: FmoRebalancePlan): void {
  const db = getDbInstance();
  const now = new Date().toISOString();
  const updateCombo = db.prepare("UPDATE combos SET data = ?, updated_at = ? WHERE id = ?");
  const insertDecision = db.prepare(
    [
      "INSERT INTO fmo_pool_decisions",
      "(generation, combo_id, provider_id, model_id, connection_id, role, outcome, reason, created_at)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join(" ")
  );

  const tx = db.transaction(() => {
    for (const [comboId, members] of Object.entries(plan.plans)) {
      const current = parseComboData(
        db.prepare("SELECT data FROM combos WHERE id = ?").get(comboId)
      );
      if (!current) throw new Error(`FMO rebalance missing combo during apply: ${comboId}`);

      updateCombo.run(
        JSON.stringify({
          ...current,
          strategy: "priority",
          models: renderModels(members),
          updatedAt: now,
        }),
        now,
        comboId
      );
    }

    db.prepare("DELETE FROM fmo_pool_decisions WHERE generation = ?").run(plan.generation);
    for (const decision of plan.decisions) {
      insertDecision.run(
        plan.generation,
        decision.comboId,
        decision.providerId,
        decision.modelId,
        decision.connectionId,
        decision.role,
        decision.outcome,
        decision.reason,
        now
      );
    }

    db.prepare(
      "INSERT OR REPLACE INTO fmo_pool_apply_marker (id, generation, applied_at) VALUES (1, ?, ?)"
    ).run(plan.generation, now);
  });

  tx();
}

export function getFmoAppliedGeneration(): string | null {
  const db = getDbInstance();
  const row = db.prepare("SELECT generation FROM fmo_pool_apply_marker WHERE id = 1").get() as
    | { generation?: string }
    | undefined;
  return row?.generation ?? null;
}

export async function rebalanceFmoPools(
  options: FmoRebalanceOptions = {}
): Promise<FmoRebalanceResult> {
  const plan = options.planOverride ?? (await buildFmoGenerationPlan());
  assertCombosExist(listComboIds(plan));

  const diffs = diffPlan(plan);
  if (options.shadow) {
    return { generation: plan.generation, shadow: true, applied: false, diffs };
  }

  applyPlan(plan);
  return { generation: plan.generation, shadow: false, applied: true, diffs };
}

export function createFmoRebalanceScheduler(options: {
  enabled: () => boolean;
  intervalMs?: number;
  run?: () => void | Promise<void>;
  logger?: Pick<Console, "warn">;
}): FmoRebalanceScheduler {
  return {
    start() {
      if (!options.enabled()) return null;
      const intervalMs = options.intervalMs ?? 12 * 60 * 60 * 1000;
      return setInterval(() => {
        Promise.resolve(options.run ? options.run() : rebalanceFmoPools()).catch((error) => {
          options.logger?.warn("[FMO] Scheduled rebalance failed", error);
        });
      }, intervalMs);
    },
  };
}
