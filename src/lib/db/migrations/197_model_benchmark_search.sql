-- Durable queue and raw evidence for newly observed models.dev identities.
-- Evidence is intentionally separate from the frozen benchmark score map.

CREATE TABLE IF NOT EXISTS model_benchmark_search_models (
  model_id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  normalization_status TEXT NOT NULL DEFAULT 'not_started',
  attempts INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_at TEXT,
  source_status_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS model_benchmark_search_evidence (
  evidence_hash TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES model_benchmark_search_models(model_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_version TEXT,
  matched_model_id TEXT,
  matched_model_name TEXT,
  benchmark TEXT,
  benchmark_version TEXT,
  reasoning_effort TEXT,
  reasoning_config_json TEXT,
  metric TEXT,
  value REAL,
  source_url TEXT NOT NULL,
  source_date TEXT,
  verification_status TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_benchmark_search_status
  ON model_benchmark_search_models(status, last_run_at);

CREATE INDEX IF NOT EXISTS idx_model_benchmark_search_evidence_model
  ON model_benchmark_search_evidence(model_id, captured_at DESC);
