import { getDbInstance } from "@/lib/db/core";
import { getFmoPoolGenerationMarker } from "@/lib/db/fmoPools";
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
  start(): ReturnType<typeof setTimeout> | null;
  reschedule(): ReturnType<typeof setTimeout> | null;
  stop(): void;
}

let lastFmoRebalanceResult: FmoRebalanceResult | null = null;
let activeScheduler: FmoRebalanceScheduler | null = null;

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

export function getFmoPoolDecisionSummary(generation: string | null): Array<{
  comboId: string;
  outcome: string;
  count: number;
}> {
  if (!generation) return [];
  const rows = getDbInstance()
    .prepare(
      [
        "SELECT combo_id, outcome, COUNT(*) AS count",
        "FROM fmo_pool_decisions",
        "WHERE generation = ?",
        "GROUP BY combo_id, outcome",
        "ORDER BY combo_id COLLATE NOCASE ASC, outcome COLLATE NOCASE ASC",
      ].join(" ")
    )
    .all(generation) as Array<{ combo_id: string; outcome: string; count: number }>;

  return rows.map((row) => ({
    comboId: row.combo_id,
    outcome: row.outcome,
    count: row.count,
  }));
}

export function getFmoRebalanceStatus(): {
  acceptedGeneration: ReturnType<typeof getFmoPoolGenerationMarker>;
  appliedGeneration: string | null;
  lastResult: FmoRebalanceResult | null;
  decisionSummary: Array<{ comboId: string; outcome: string; count: number }>;
} {
  const acceptedGeneration = getFmoPoolGenerationMarker();
  const appliedGeneration = getFmoAppliedGeneration();
  return {
    acceptedGeneration,
    appliedGeneration,
    lastResult: lastFmoRebalanceResult,
    decisionSummary: getFmoPoolDecisionSummary(appliedGeneration),
  };
}

export async function rebalanceFmoPools(
  options: FmoRebalanceOptions = {}
): Promise<FmoRebalanceResult> {
  const plan = options.planOverride ?? (await buildFmoGenerationPlan());
  assertCombosExist(listComboIds(plan));

  const diffs = diffPlan(plan);
  if (options.shadow) {
    const result = { generation: plan.generation, shadow: true, applied: false, diffs };
    lastFmoRebalanceResult = result;
    return result;
  }

  applyPlan(plan);
  const result = { generation: plan.generation, shadow: false, applied: true, diffs };
  lastFmoRebalanceResult = result;
  return result;
}

export function createFmoRebalanceScheduler(options: {
  enabled: () => boolean;
  intervalMs?: number | (() => number | null);
  run?: () => void | Promise<void>;
  logger?: Pick<Console, "warn">;
}): FmoRebalanceScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function getIntervalMs(): number | null {
    if (typeof options.intervalMs === "function") return options.intervalMs();
    if (typeof options.intervalMs === "number") return options.intervalMs;

    const marker = getFmoPoolGenerationMarker();
    if (!marker) return null;
    return marker.rebalanceIntervalMinutes * 60 * 1000;
  }

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function schedule(): ReturnType<typeof setTimeout> | null {
    clearTimer();
    if (!options.enabled()) return null;

    const intervalMs = getIntervalMs();
    if (!intervalMs || intervalMs <= 0) return null;

    timer = setTimeout(() => {
      Promise.resolve(options.run ? options.run() : rebalanceFmoPools())
        .catch((error) => {
          options.logger?.warn("[FMO] Scheduled rebalance failed", error);
        })
        .finally(() => {
          schedule();
        });
    }, intervalMs);
    return timer;
  }

  const scheduler: FmoRebalanceScheduler = {
    start() {
      return schedule();
    },
    reschedule() {
      return schedule();
    },
    stop() {
      clearTimer();
    },
  };

  activeScheduler = scheduler;
  return scheduler;
}

export function rescheduleActiveFmoRebalance(): void {
  activeScheduler?.reschedule();
}

export function getFmoRebalanceIntervalMs(): number | null {
  const marker = getFmoPoolGenerationMarker();
  return marker ? marker.rebalanceIntervalMinutes * 60 * 1000 : null;
}
