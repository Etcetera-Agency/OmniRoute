import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const EXPECTED_MIGRATIONS = [
  "197_model_benchmark_search.sql",
  "198_model_benchmark_catalog_backfill.sql",
  "199_model_benchmark_search_retry_after.sql",
  "200_proxy_subscription_core_config.sql",
  "201_proxy_subscription_core_binary.sql",
  "202_proxy_operator_egress.sql",
  "203_provider_health_matrix_covering_index.sql",
  "204_drop_unused_turn_node_indexes.sql",
  "205_model_capabilities_reasoning_efforts.sql",
  "206_memory_fts_content_rowid.sql",
  "207_llmlingua_service.sql",
  "208_api_key_codex_service_mode.sql",
  "209_codex_wakeup_tasks.sql",
  "210_remove_opencode_free_provider.sql",
  "211_proxy_subscription_selector_last_switch_by_selector.sql",
  "212_call_logs_artifact_relpath_index.sql",
  "213_call_logs_detail_pending.sql",
  "214_recreate_turn_nodes_content_hash_index.sql",
  "215_usage_history_provider_reported_cost.sql",
  "216_model_benchmark_evidence_current_set.sql",
];

const OFFICIAL_DIGEST =
  "sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c";
const OFFICIAL_IMAGE = `ghcr.io/diegosouzapw/omniroute@${OFFICIAL_DIGEST}`;

test("v3.8.52 migration files use the reviewed fork and upstream version map", () => {
  const dir = path.join(process.cwd(), "src/lib/db/migrations");
  const migratedTail = fs
    .readdirSync(dir)
    .filter((name) => Number(name.match(/^(\d+)_/)?.[1]) >= 197)
    .sort();

  assert.deepEqual(migratedTail, EXPECTED_MIGRATIONS);
});

test("both overlay base pins identify the official v3.8.52 index digest", () => {
  const workflow = fs.readFileSync(".github/workflows/omni-overlay-image.yml", "utf8");
  const dockerfile = fs.readFileSync("docker/official-backend-overlay.Dockerfile", "utf8");

  assert.ok(workflow.includes(`OFFICIAL_IMAGE: ${OFFICIAL_IMAGE}`));
  assert.ok(workflow.includes(`OFFICIAL_BASE_DIGEST: ${OFFICIAL_DIGEST}`));
  assert.ok(dockerfile.includes(`ARG OFFICIAL_IMAGE=${OFFICIAL_IMAGE}`));
  assert.ok(dockerfile.includes(`ARG OFFICIAL_BASE_DIGEST=${OFFICIAL_DIGEST}`));
});
