import { getDbInstance } from "./core";
import type { FmoPlanningPool } from "@/lib/fmoPools/types";
import type { FmoPoolSpec, FmoPoolsGeneration } from "@/shared/schemas/fmoPools";

export interface FmoPoolGenerationMarker {
  generation: string;
  contract: string;
  poolCount: number;
  idempotencyKey: string | null;
  acceptedAt: string;
}

export interface StoredFmoPoolSpec {
  poolId: string;
  generation: string;
  comboId: string;
  status: "accepted";
  spec: FmoPoolSpec;
  createdAt: string;
  updatedAt: string;
}

type StoredPoolRow = {
  pool_id: string;
  generation: string;
  combo_id: string;
  status: string;
  spec_json: string;
  created_at: string;
  updated_at: string;
};

type MarkerRow = {
  generation: string;
  contract: string;
  pool_count: number;
  idempotency_key: string | null;
  accepted_at: string;
};

function parseStoredPool(row: StoredPoolRow): StoredFmoPoolSpec {
  return {
    poolId: row.pool_id,
    generation: row.generation,
    comboId: row.combo_id,
    status: "accepted",
    spec: JSON.parse(row.spec_json) as FmoPoolSpec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseMarker(row: MarkerRow): FmoPoolGenerationMarker {
  return {
    generation: row.generation,
    contract: row.contract,
    poolCount: row.pool_count,
    idempotencyKey: row.idempotency_key,
    acceptedAt: row.accepted_at,
  };
}

export function listMissingFmoPoolComboIds(comboIds: string[]): string[] {
  const uniqueIds = [...new Set(comboIds)];
  if (uniqueIds.length === 0) return [];

  const db = getDbInstance();
  const existing = new Set<string>();
  const lookup = db.prepare("SELECT id FROM combos WHERE id = ?");

  for (const comboId of uniqueIds) {
    const row = lookup.get(comboId) as { id?: string } | undefined;
    if (row?.id === comboId) existing.add(comboId);
  }

  return uniqueIds.filter((comboId) => !existing.has(comboId));
}

export function storeFmoPoolsGeneration(
  generation: FmoPoolsGeneration,
  idempotencyKey: string | null
): FmoPoolGenerationMarker {
  const db = getDbInstance();
  const now = new Date().toISOString();

  const writeGeneration = db.transaction(() => {
    db.prepare("DELETE FROM fmo_pool_specs").run();

    const insertPool = db.prepare(
      [
        "INSERT INTO fmo_pool_specs",
        "(pool_id, generation, combo_id, status, spec_json, created_at, updated_at)",
        "VALUES (?, ?, ?, 'accepted', ?, ?, ?)",
      ].join(" ")
    );

    for (const pool of generation.pools) {
      insertPool.run(
        pool.pool_id,
        generation.generation,
        pool.combo_id,
        JSON.stringify(pool),
        now,
        now
      );
    }

    db.prepare(
      [
        "INSERT OR REPLACE INTO fmo_pool_generation_marker",
        "(id, generation, contract, pool_count, idempotency_key, accepted_at)",
        "VALUES (1, ?, ?, ?, ?, ?)",
      ].join(" ")
    ).run(
      generation.generation,
      generation.contract_version,
      generation.pools.length,
      idempotencyKey,
      now
    );
  });

  writeGeneration();
  return {
    generation: generation.generation,
    contract: generation.contract_version,
    poolCount: generation.pools.length,
    idempotencyKey,
    acceptedAt: now,
  };
}

export function getFmoPoolGenerationMarker(): FmoPoolGenerationMarker | null {
  const db = getDbInstance();
  const row = db
    .prepare(
      "SELECT generation, contract, pool_count, idempotency_key, accepted_at FROM fmo_pool_generation_marker WHERE id = 1"
    )
    .get() as MarkerRow | undefined;

  return row ? parseMarker(row) : null;
}

export function listFmoPoolSpecs(): StoredFmoPoolSpec[] {
  const db = getDbInstance();
  const rows = db
    .prepare(
      [
        "SELECT pool_id, generation, combo_id, status, spec_json, created_at, updated_at",
        "FROM fmo_pool_specs ORDER BY pool_id COLLATE NOCASE ASC",
      ].join(" ")
    )
    .all() as StoredPoolRow[];

  return rows.map(parseStoredPool);
}

export function mapFmoPoolSpecToPlanningPool(spec: FmoPoolSpec): FmoPlanningPool {
  // AICODE-NOTE: This is the canonical wire-contract boundary; solver code consumes this internal shape only.
  return {
    pool_id: spec.pool_id,
    combo_id: spec.combo_id,
    demand: {
      requests_per_day: spec.demand.requests_per_day,
      consumers: spec.demand.consumers,
    },
    constraints: {
      min_context_tokens: spec.constraints.min_context_tokens,
      quality_band: {
        source: spec.constraints.quality_band.source,
        metric: spec.constraints.quality_band.metric,
        category: spec.constraints.quality_band.category,
        min: spec.constraints.quality_band.min,
        max: spec.constraints.quality_band.max,
        relax: spec.constraints.quality_band.relax.max_delta,
      },
      required_capabilities: spec.constraints.capabilities,
      hard_gates: spec.constraints.free_only ? ["free_only"] : [],
      free_only: spec.constraints.free_only,
    },
    tail: spec.tail,
    metadata: spec.metadata,
    workload_class: spec.demand.workload_class,
  };
}

export function listFmoPlanningPools(): FmoPlanningPool[] {
  return listFmoPoolSpecs().map((pool) => mapFmoPoolSpecToPlanningPool(pool.spec));
}

export function getFmoPoolUsageBackchannel(): {
  marker: FmoPoolGenerationMarker | null;
  pools: Array<{ poolId: string; comboId: string; generation: string; status: "accepted" }>;
} {
  return {
    marker: getFmoPoolGenerationMarker(),
    pools: listFmoPoolSpecs().map((pool) => ({
      poolId: pool.poolId,
      comboId: pool.comboId,
      generation: pool.generation,
      status: pool.status,
    })),
  };
}
