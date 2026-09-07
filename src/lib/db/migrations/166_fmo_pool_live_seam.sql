ALTER TABLE fmo_pool_generation_marker
ADD COLUMN rebalance_interval_minutes INTEGER NOT NULL DEFAULT 720;
