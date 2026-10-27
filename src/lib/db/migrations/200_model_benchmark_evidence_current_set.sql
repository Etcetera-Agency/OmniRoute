-- Rename benchmark evidence table before switching writers to current-set storage.
ALTER TABLE model_benchmark_search_evidence RENAME TO model_benchmark_evidence;

ALTER TABLE model_benchmark_evidence DROP COLUMN raw_json;
