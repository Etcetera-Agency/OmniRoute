CREATE TABLE IF NOT EXISTS fmo_pool_specs (
  pool_id TEXT PRIMARY KEY,
  generation TEXT NOT NULL,
  combo_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  spec_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fmo_pool_specs_generation ON fmo_pool_specs(generation);
CREATE INDEX IF NOT EXISTS idx_fmo_pool_specs_combo_id ON fmo_pool_specs(combo_id);

CREATE TABLE IF NOT EXISTS fmo_pool_generation_marker (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation TEXT NOT NULL,
  contract TEXT NOT NULL,
  pool_count INTEGER NOT NULL,
  idempotency_key TEXT,
  accepted_at TEXT NOT NULL
);
