import { getDbInstance } from "./core";

const MAX_SEARCH_ATTEMPTS = 5;
const STALE_SEARCH_RUN_MS = 15 * 60 * 1000;
const MISSING_AA_API_KEY_ERROR = "AA Free API key is not configured";

function canRetryMissingAaApiKey(): boolean {
  return Boolean(process.env.AA_API_KEY?.trim());
}

export interface ModelBenchmarkSearchIdentity {
  id: string;
  name: string;
}

export interface ModelCapabilityIdentitySnapshot {
  hasRows: boolean;
  ids: Set<string>;
}

export interface ModelBenchmarkSearchRun {
  modelId: string;
  modelName: string;
  status: string;
  normalizationStatus: string;
  attempts: number;
  firstSeenAt: string;
  lastRunAt: string | null;
  retryAfterAt: string | null;
  sourceStatus: Record<string, unknown>;
  lastError: string | null;
}

export interface ModelBenchmarkSearchEvidence {
  evidenceHash: string;
  modelId: string;
  source: string;
  sourceVersion: string | null;
  matchedModelId: string | null;
  matchedModelName: string | null;
  benchmark: string | null;
  benchmarkVersion: string | null;
  reasoningEffort: string | null;
  reasoningConfig: unknown;
  metric: string | null;
  value: number | null;
  sourceUrl: string;
  sourceDate: string | null;
  verificationStatus: string;
  capturedAt: string;
  raw: unknown;
}

export type ModelBenchmarkSearchEvidenceInput = ModelBenchmarkSearchEvidence;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJson(value: unknown, fallback: unknown = null): unknown {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function getModelCapabilityIdentitySnapshot(): ModelCapabilityIdentitySnapshot {
  const db = getDbInstance();
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'model_capabilities'")
    .get();
  if (!table) return { hasRows: false, ids: new Set() };

  const rows = db.prepare("SELECT DISTINCT model_id FROM model_capabilities").all();
  const ids = new Set(
    rows
      .map((row) => asRecord(row).model_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  return { hasRows: ids.size > 0, ids };
}

export function enqueueModelBenchmarkSearches(identities: ModelBenchmarkSearchIdentity[]): void {
  if (identities.length === 0) return;
  const db = getDbInstance();
  const upsert = db.prepare(`
    INSERT INTO model_benchmark_search_models (model_id, model_name)
    VALUES (?, ?)
    ON CONFLICT(model_id) DO UPDATE SET model_name = excluded.model_name
  `);
  const tx = db.transaction(() => {
    for (const identity of identities) upsert.run(identity.id, identity.name);
  });
  tx();
}

export function enqueueModelsDevCatalogIdentities(
  identities: ModelBenchmarkSearchIdentity[],
  previous: ModelCapabilityIdentitySnapshot
): { fullBackfill: boolean; queued: number } {
  if (identities.length === 0) return { fullBackfill: false, queued: 0 };

  const db = getDbInstance();
  const insertModel = db.prepare(`
    INSERT OR IGNORE INTO model_benchmark_search_models (model_id, model_name)
    VALUES (?, ?)
  `);
  const updateModelName = db.prepare(
    "UPDATE model_benchmark_search_models SET model_name = ? WHERE model_id = ?"
  );
  const tx = db.transaction(() => {
    const marker = db
      .prepare("SELECT state_value FROM model_benchmark_search_state WHERE state_key = ?")
      .get("models_dev_full_catalog_backfill");
    const fullBackfill = !marker || !previous.hasRows;
    let queued = 0;

    for (const identity of identities) {
      const shouldQueue = fullBackfill || !previous.ids.has(identity.id);
      if (!shouldQueue) {
        updateModelName.run(identity.name, identity.id);
        continue;
      }

      const inserted = insertModel.run(identity.id, identity.name).changes;
      queued += inserted;
      if (inserted === 0) updateModelName.run(identity.name, identity.id);
    }

    if (!marker) {
      db.prepare(
        `INSERT INTO model_benchmark_search_state (state_key, state_value)
         VALUES (?, ?)`
      ).run("models_dev_full_catalog_backfill", "queued");
    }

    return { fullBackfill, queued };
  });

  return tx();
}

export function listModelBenchmarkSearchCatalogModels(): ModelBenchmarkSearchIdentity[] {
  return getDbInstance()
    .prepare("SELECT model_id, model_name FROM model_benchmark_search_models ORDER BY model_id")
    .all()
    .map((row) => {
      const record = asRecord(row);
      return { id: String(record.model_id), name: String(record.model_name) };
    });
}

export function isModelBenchmarkSearchNameUnique(name: string): boolean {
  if (!name.trim()) return false;
  const row = getDbInstance()
    .prepare(
      `SELECT COUNT(*) AS count FROM model_benchmark_search_models
       WHERE lower(trim(model_name)) = lower(trim(?))`
    )
    .get(name);
  return Number(asRecord(row).count) === 1;
}

export function updateModelBenchmarkSearchSourceStatus(
  modelId: string,
  sourceStatus: Record<string, unknown>
): void {
  getDbInstance()
    .prepare(
      `UPDATE model_benchmark_search_models
       SET source_status_json = ?
       WHERE model_id = ?`
    )
    .run(JSON.stringify(sourceStatus), modelId);
}

export function hasEligibleModelBenchmarkSearch(): boolean {
  const now = Date.now();
  if (getModelBenchmarkSearchRetryDelay() !== null) return false;
  const retryBefore = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(now - STALE_SEARCH_RUN_MS).toISOString();
  const row = getDbInstance()
    .prepare(
      `SELECT 1 FROM model_benchmark_search_models
       WHERE (
         (attempts < ? AND (
           (
             (status IN ('pending', 'source_error', 'pending_unrated') OR
              (status = 'review_required' AND retry_after_at IS NOT NULL))
             AND (
               (retry_after_at IS NOT NULL AND retry_after_at <= ?) OR
               (retry_after_at IS NULL AND (last_run_at IS NULL OR last_run_at <= ?))
             )
           ) OR (status = 'running' AND last_run_at <= ?)
         )) OR (
           ? = 1 AND status IN ('source_error', 'retry_exhausted_unrated')
           AND last_error = ?
         )
       ) LIMIT 1`
    )
    .get(
      MAX_SEARCH_ATTEMPTS,
      new Date(now).toISOString(),
      retryBefore,
      staleBefore,
      Number(canRetryMissingAaApiKey()),
      MISSING_AA_API_KEY_ERROR
    );
  return row !== undefined;
}

export function expireExhaustedModelBenchmarkSearchRuns(): void {
  // AICODE-NOTE: Terminalize exhausted rows before eligibility checks so
  // cleanup-only drains do not fetch source snapshots.
  const staleBefore = new Date(Date.now() - STALE_SEARCH_RUN_MS).toISOString();
  getDbInstance()
    .prepare(
      `UPDATE model_benchmark_search_models
       SET status = 'retry_exhausted_unrated'
       WHERE attempts >= ? AND (
         status IN ('pending', 'source_error', 'pending_unrated') OR
         (status = 'running' AND last_run_at <= ?)
       )`
    )
    .run(MAX_SEARCH_ATTEMPTS, staleBefore);
}

export function listEligibleModelBenchmarkSearchRuns(limit: number): ModelBenchmarkSearchRun[] {
  const now = Date.now();
  if (getModelBenchmarkSearchRetryDelay() !== null) return [];
  const retryBefore = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(now - STALE_SEARCH_RUN_MS).toISOString();
  return getDbInstance()
    .prepare(
      `SELECT * FROM model_benchmark_search_models
       WHERE (
         (attempts < ? AND (
           (
             (status IN ('pending', 'source_error', 'pending_unrated') OR
              (status = 'review_required' AND retry_after_at IS NOT NULL))
             AND (
               (retry_after_at IS NOT NULL AND retry_after_at <= ?) OR
               (retry_after_at IS NULL AND (last_run_at IS NULL OR last_run_at <= ?))
             )
           ) OR (status = 'running' AND last_run_at <= ?)
         )) OR (
           ? = 1 AND status IN ('source_error', 'retry_exhausted_unrated')
           AND last_error = ?
         )
       )
       ORDER BY CASE WHEN retry_after_at IS NOT NULL THEN 0 ELSE 1 END,
                first_seen_at, model_id
       LIMIT ?`
    )
    .all(
      MAX_SEARCH_ATTEMPTS,
      new Date(now).toISOString(),
      retryBefore,
      staleBefore,
      Number(canRetryMissingAaApiKey()),
      MISSING_AA_API_KEY_ERROR,
      Math.max(1, Math.min(100, Math.floor(limit)))
    )
    .map(mapSearchRun);
}

export function getModelBenchmarkSearchRetryDelay(): number | null {
  // AICODE-NOTE: Any stored free-provider cooldown pauses the queue after restart too.
  const row = getDbInstance()
    .prepare(
      `SELECT MIN(retry_after_at) AS retry_after_at
       FROM model_benchmark_search_models
       WHERE retry_after_at > ?`
    )
    .get(new Date().toISOString());
  const retryAfterAt = asRecord(row).retry_after_at;
  if (typeof retryAfterAt !== "string") return null;
  const retryAt = Date.parse(retryAfterAt);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

export function getModelBenchmarkSearchStaleRetryDelay(): number | null {
  const row = getDbInstance()
    .prepare(
      `SELECT MIN(last_run_at) AS last_run_at
       FROM model_benchmark_search_models
       WHERE status = 'running'`
    )
    .get();
  const lastRunAt = asRecord(row).last_run_at;
  if (typeof lastRunAt !== "string") return null;
  const staleAt = Date.parse(lastRunAt) + STALE_SEARCH_RUN_MS;
  return Number.isFinite(staleAt) ? Math.max(0, staleAt - Date.now()) : 0;
}

export function claimModelBenchmarkSearch(): ModelBenchmarkSearchRun | null {
  const db = getDbInstance();
  const now = new Date();
  const retryBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(now.getTime() - STALE_SEARCH_RUN_MS).toISOString();
  const nowIso = now.toISOString();
  const retryMissingAaApiKey = Number(canRetryMissingAaApiKey());
  let claimed: unknown = null;

  db.immediate(() => {
    const pendingRetry = db
      .prepare("SELECT 1 FROM model_benchmark_search_models WHERE retry_after_at > ? LIMIT 1")
      .get(nowIso);
    if (pendingRetry) return;
    db.prepare(
      `
      UPDATE model_benchmark_search_models
      SET status = 'retry_exhausted_unrated'
      WHERE attempts >= ? AND (
        status IN ('pending', 'source_error', 'pending_unrated') OR
        (status = 'running' AND last_run_at <= ?)
      )
    `
    ).run(MAX_SEARCH_ATTEMPTS, staleBefore);
    const row = db
      .prepare(
        `
        SELECT * FROM model_benchmark_search_models
        WHERE (
          (attempts < ? AND (
            (
              (status IN ('pending', 'source_error', 'pending_unrated') OR
               (status = 'review_required' AND retry_after_at IS NOT NULL))
             AND (
               (retry_after_at IS NOT NULL AND retry_after_at <= ?) OR
               (retry_after_at IS NULL AND (last_run_at IS NULL OR last_run_at <= ?))
             )
            ) OR (status = 'running' AND last_run_at <= ?)
          )) OR (
            ? = 1 AND status IN ('source_error', 'retry_exhausted_unrated')
            AND last_error = ?
          )
        )
        ORDER BY CASE WHEN retry_after_at IS NOT NULL THEN 0 ELSE 1 END,
                 first_seen_at, model_id
        LIMIT 1
      `
      )
      .get(
        MAX_SEARCH_ATTEMPTS,
        nowIso,
        retryBefore,
        staleBefore,
        retryMissingAaApiKey,
        MISSING_AA_API_KEY_ERROR
      );
    if (!row) return;
    const modelId = asRecord(row).model_id;
    if (typeof modelId !== "string") return;
    const result = db
      .prepare(
        `
        UPDATE model_benchmark_search_models
        SET status = 'running', attempts = attempts + 1, last_run_at = ?, last_error = NULL,
            retry_after_at = NULL
        WHERE model_id = ? AND (
          (attempts < ? AND (
            (
              (status IN ('pending', 'source_error', 'pending_unrated') OR
               (status = 'review_required' AND retry_after_at IS NOT NULL))
              AND (
                (retry_after_at IS NOT NULL AND retry_after_at <= ?) OR
                (retry_after_at IS NULL AND (last_run_at IS NULL OR last_run_at <= ?))
              )
            ) OR (status = 'running' AND last_run_at <= ?)
          )) OR (
            ? = 1 AND status IN ('source_error', 'retry_exhausted_unrated')
            AND last_error = ?
          )
        )
      `
      )
      .run(
        nowIso,
        modelId,
        MAX_SEARCH_ATTEMPTS,
        nowIso,
        retryBefore,
        staleBefore,
        retryMissingAaApiKey,
        MISSING_AA_API_KEY_ERROR
      );
    if (result.changes > 0) {
      claimed = { ...asRecord(row), last_run_at: nowIso, retry_after_at: null };
    }
  });

  return claimed ? mapSearchRun(claimed) : null;
}

export function finishModelBenchmarkSearch(input: {
  modelId: string;
  status: string;
  normalizationStatus: string;
  sourceStatus: Record<string, unknown>;
  lastError?: string | null;
  retryAfterAt?: string | null;
  consumeAttempt?: boolean;
}): void {
  getDbInstance()
    .prepare(
      `
      UPDATE model_benchmark_search_models
      SET status = ?, normalization_status = ?, source_status_json = ?, last_error = ?,
          retry_after_at = ?, attempts = MAX(0, attempts - ?)
      WHERE model_id = ?
    `
    )
    .run(
      input.status,
      input.normalizationStatus,
      JSON.stringify(input.sourceStatus),
      input.lastError ?? null,
      input.retryAfterAt ?? null,
      input.consumeAttempt === false ? 1 : 0,
      input.modelId
    );
}

export function saveModelBenchmarkSearchEvidence(
  rows: ModelBenchmarkSearchEvidenceInput[]
): number {
  if (rows.length === 0) return 0;
  const db = getDbInstance();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO model_benchmark_search_evidence (
      evidence_hash, model_id, source, source_version, matched_model_id,
      matched_model_name, benchmark, benchmark_version, reasoning_effort,
      reasoning_config_json, metric, value, source_url, source_date,
      verification_status, captured_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      inserted += insert.run(
        row.evidenceHash,
        row.modelId,
        row.source,
        row.sourceVersion,
        row.matchedModelId,
        row.matchedModelName,
        row.benchmark,
        row.benchmarkVersion,
        row.reasoningEffort,
        row.reasoningConfig == null ? null : JSON.stringify(row.reasoningConfig),
        row.metric,
        row.value,
        row.sourceUrl,
        row.sourceDate,
        row.verificationStatus,
        row.capturedAt,
        JSON.stringify(row.raw)
      ).changes;
    }
  });
  tx();
  return inserted;
}

export function listModelBenchmarkSearchRuns(limit = 100): ModelBenchmarkSearchRun[] {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return getDbInstance()
    .prepare(
      `
      SELECT * FROM model_benchmark_search_models
      ORDER BY first_seen_at DESC, model_id
      LIMIT ?
    `
    )
    .all(boundedLimit)
    .map(mapSearchRun);
}

export function listModelBenchmarkSearchEvidence(
  modelId: string,
  limit = 100
): ModelBenchmarkSearchEvidence[] {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return getDbInstance()
    .prepare(
      `
      SELECT * FROM model_benchmark_search_evidence
      WHERE model_id = ?
      ORDER BY captured_at DESC, evidence_hash
      LIMIT ?
    `
    )
    .all(modelId, boundedLimit)
    .map(mapEvidenceRow);
}

export function listAllModelBenchmarkSearchEvidence(): ModelBenchmarkSearchEvidence[] {
  return getDbInstance()
    .prepare(
      `SELECT * FROM model_benchmark_search_evidence
       ORDER BY model_id, captured_at DESC, evidence_hash`
    )
    .all()
    .map(mapEvidenceRow);
}

function mapEvidenceRow(value: unknown): ModelBenchmarkSearchEvidence {
  const record = asRecord(value);
  return {
    evidenceHash: String(record.evidence_hash),
    modelId: String(record.model_id),
    source: String(record.source),
    sourceVersion: typeof record.source_version === "string" ? record.source_version : null,
    matchedModelId: typeof record.matched_model_id === "string" ? record.matched_model_id : null,
    matchedModelName:
      typeof record.matched_model_name === "string" ? record.matched_model_name : null,
    benchmark: typeof record.benchmark === "string" ? record.benchmark : null,
    benchmarkVersion:
      typeof record.benchmark_version === "string" ? record.benchmark_version : null,
    reasoningEffort: typeof record.reasoning_effort === "string" ? record.reasoning_effort : null,
    reasoningConfig: parseJson(record.reasoning_config_json),
    metric: typeof record.metric === "string" ? record.metric : null,
    value: typeof record.value === "number" ? record.value : null,
    sourceUrl: String(record.source_url),
    sourceDate: typeof record.source_date === "string" ? record.source_date : null,
    verificationStatus: String(record.verification_status),
    capturedAt: String(record.captured_at),
    raw: parseJson(record.raw_json),
  };
}

function mapSearchRun(value: unknown): ModelBenchmarkSearchRun {
  const record = asRecord(value);
  return {
    modelId: String(record.model_id),
    modelName: String(record.model_name),
    status: String(record.status),
    normalizationStatus: String(record.normalization_status),
    attempts: Number(record.attempts),
    firstSeenAt: String(record.first_seen_at),
    lastRunAt: typeof record.last_run_at === "string" ? record.last_run_at : null,
    retryAfterAt: typeof record.retry_after_at === "string" ? record.retry_after_at : null,
    sourceStatus: asRecord(parseJson(record.source_status_json, {})),
    lastError: typeof record.last_error === "string" ? record.last_error : null,
  };
}
