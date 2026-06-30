CREATE TABLE IF NOT EXISTS fmo_pool_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation TEXT NOT NULL,
  combo_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  connection_id TEXT,
  role TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fmo_pool_decisions_generation ON fmo_pool_decisions(generation);
CREATE INDEX IF NOT EXISTS idx_fmo_pool_decisions_combo ON fmo_pool_decisions(combo_id);

CREATE TABLE IF NOT EXISTS fmo_pool_apply_marker (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
