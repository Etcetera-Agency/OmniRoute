-- Transactional state marker for the one-time full models.dev benchmark backfill.
CREATE TABLE IF NOT EXISTS model_benchmark_search_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_model_benchmark_search_models_name_folded
ON model_benchmark_search_models (lower(trim(model_name)));
