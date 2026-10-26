import { getDbInstance } from "./core";

const MAX_SEARCH_ATTEMPTS = 5;

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
  const insert = db.prepare(`
    INSERT OR IGNORE INTO model_benchmark_search_models (model_id, model_name)
    VALUES (?, ?)
  `);
  const tx = db.transaction(() => {
    for (const identity of identities) insert.run(identity.id, identity.name);
  });
  tx();
}

export function claimModelBenchmarkSearch(): ModelBenchmarkSearchRun | null {
  const db = getDbInstance();
  const now = new Date();
  const retryBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  let claimed: unknown = null;

  db.immediate(() => {
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
        WHERE attempts < ? AND (
          (
            status IN ('pending', 'source_error', 'pending_unrated')
            AND (last_run_at IS NULL OR last_run_at <= ?)
          ) OR (status = 'running' AND last_run_at <= ?)
        )
        ORDER BY first_seen_at, model_id
        LIMIT 1
      `
      )
      .get(MAX_SEARCH_ATTEMPTS, retryBefore, staleBefore);
    if (!row) return;
    const modelId = asRecord(row).model_id;
    if (typeof modelId !== "string") return;
    const result = db
      .prepare(
        `
        UPDATE model_benchmark_search_models
        SET status = 'running', attempts = attempts + 1, last_run_at = ?, last_error = NULL
        WHERE model_id = ? AND attempts < ? AND (
          status IN ('pending', 'source_error', 'pending_unrated') OR
          (status = 'running' AND last_run_at <= ?)
        )
      `
      )
      .run(nowIso, modelId, MAX_SEARCH_ATTEMPTS, staleBefore);
    if (result.changes > 0) claimed = { ...asRecord(row), last_run_at: nowIso };
  });

  return claimed ? mapSearchRun(claimed) : null;
}

export function finishModelBenchmarkSearch(input: {
  modelId: string;
  status: string;
  normalizationStatus: string;
  sourceStatus: Record<string, unknown>;
  lastError?: string | null;
}): void {
  getDbInstance()
    .prepare(
      `
      UPDATE model_benchmark_search_models
      SET status = ?, normalization_status = ?, source_status_json = ?, last_error = ?
      WHERE model_id = ?
    `
    )
    .run(
      input.status,
      input.normalizationStatus,
      JSON.stringify(input.sourceStatus),
      input.lastError ?? null,
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
    .map((row) => {
      const record = asRecord(row);
      return {
        evidenceHash: String(record.evidence_hash),
        modelId: String(record.model_id),
        source: String(record.source),
        sourceVersion: typeof record.source_version === "string" ? record.source_version : null,
        matchedModelId:
          typeof record.matched_model_id === "string" ? record.matched_model_id : null,
        matchedModelName:
          typeof record.matched_model_name === "string" ? record.matched_model_name : null,
        benchmark: typeof record.benchmark === "string" ? record.benchmark : null,
        benchmarkVersion:
          typeof record.benchmark_version === "string" ? record.benchmark_version : null,
        reasoningEffort:
          typeof record.reasoning_effort === "string" ? record.reasoning_effort : null,
        reasoningConfig: parseJson(record.reasoning_config_json),
        metric: typeof record.metric === "string" ? record.metric : null,
        value: typeof record.value === "number" ? record.value : null,
        sourceUrl: String(record.source_url),
        sourceDate: typeof record.source_date === "string" ? record.source_date : null,
        verificationStatus: String(record.verification_status),
        capturedAt: String(record.captured_at),
        raw: parseJson(record.raw_json),
      };
    });
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
    sourceStatus: asRecord(parseJson(record.source_status_json, {})),
    lastError: typeof record.last_error === "string" ? record.last_error : null,
  };
}
