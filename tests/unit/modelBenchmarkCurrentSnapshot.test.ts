import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-benchmark-current-"));
process.env.DATA_DIR = TEST_DATA_DIR;
const core = await import("../../src/lib/db/core.ts");
const searchDb = await import("../../src/lib/db/modelBenchmarkSearch.ts");
const migrationRunner = await import("../../src/lib/db/migrationRunner.ts");

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(resetStorage);
test.afterEach(() => core.resetDbInstance());
test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("migration renames benchmark evidence table and keeps schema idempotent", () => {
  const db = core.getDbInstance();
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.ok(names.includes("model_benchmark_evidence"));
  assert.equal(names.includes("model_benchmark_search_evidence"), false);
  core.resetDbInstance();
  const reopened = core.getDbInstance();
  const reopenedNames = reopened
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.ok(reopenedNames.includes("model_benchmark_evidence"));
  assert.equal(reopenedNames.includes("model_benchmark_search_evidence"), false);
});

test("migration preserves formula observations and removes raw payloads", async () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE model_benchmark_search_models (model_id TEXT PRIMARY KEY);
    CREATE TABLE model_benchmark_search_evidence (
      evidence_hash TEXT PRIMARY KEY,
      model_id TEXT NOT NULL REFERENCES model_benchmark_search_models(model_id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      benchmark TEXT,
      benchmark_version TEXT,
      reasoning_effort TEXT,
      reasoning_config_json TEXT,
      metric TEXT,
      value REAL,
      source_version TEXT,
      matched_model_id TEXT,
      matched_model_name TEXT,
      source_url TEXT,
      source_date TEXT,
      verification_status TEXT,
      captured_at TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE INDEX idx_model_benchmark_search_evidence_model
      ON model_benchmark_search_evidence(model_id, source);
    INSERT INTO model_benchmark_search_models VALUES ('legacy-model');
    INSERT INTO model_benchmark_search_models VALUES ('other');
    INSERT INTO model_benchmark_search_models VALUES ('swe-bench');
    INSERT INTO model_benchmark_search_evidence VALUES (
      'hash-low', 'legacy-model', 'swe-bench', 'SWE-bench Verified', '1',
      'low', '{"harness":"agent-a"}', 'resolved', 0.4, 'v1', 'legacy-model',
      'Legacy Model', 'https://example.test/swe', '2026-10-26', 'verified',
      '2026-10-26T00:00:00.000Z', '{"legacy":"source-a"}'
    );
    INSERT INTO model_benchmark_search_evidence VALUES (
      'hash-high', 'legacy-model', 'swe-bench', 'SWE-bench Verified', '1',
      'high', '{"harness":"agent-b","tier":{"a":1,"b":2}}', 'resolved', 0.8, 'v1', 'legacy-model',
      'Legacy Model', 'https://example.test/swe', '2026-10-26', 'verified',
      '2026-10-26T00:00:00.000Z', '{"legacy":"source-b"}'
    );
  `);
  const insertLegacy = db.prepare(`
    INSERT INTO model_benchmark_search_evidence VALUES (
      ?, 'legacy-model', ?, 'SWE-bench Verified', '1', ?, ?, ?, ?, 'v1',
      'legacy-model', 'Legacy Model', 'https://example.test/benchmark',
      '2026-10-26', ?, ?, ?
    )
  `);
  insertLegacy.run(
    "hash-high-old",
    "swe-bench",
    "high",
    '{"harness":"agent-b","tier":{"a":1,"b":2}}',
    "resolved",
    0.2,
    "verified",
    "2026-10-25T00:00:00.000Z",
    '{"legacy":"old-high"}'
  );
  insertLegacy.run(
    "hash-tie-a",
    "swe-bench",
    "high",
    '{"harness":"agent-b","tier":{"a":1,"b":2}}',
    "resolved",
    0.85,
    "verified",
    "2026-10-27T00:00:00.000Z",
    '{"legacy":"tie-a"}'
  );
  insertLegacy.run(
    "hash-tie-z",
    "swe-bench",
    "high",
    '{"tier":{"b":2,"a":1},"harness":"agent-b"}',
    "resolved",
    0.9,
    "verified",
    "2026-10-27T00:00:00.000Z",
    '{"legacy":"tie-z"}'
  );
  insertLegacy.run(
    "hash-alias",
    "swe-bench",
    "high",
    '{"harness":"agent-b","tier":{"a":1,"b":2}}',
    "resolved_rate",
    0.88,
    "verified",
    "2026-10-27T00:00:00.000Z",
    '{"legacy":"metric-alias"}'
  );
  insertLegacy.run(
    "hash-hf",
    "huggingface-eval-results",
    "medium",
    '{"harness":"hf-agent"}',
    "resolved",
    0.6,
    "verified",
    "2026-10-26T12:00:00.000Z",
    '{"legacy":"hf"}'
  );
  insertLegacy.run(
    "hash-search",
    "duckduckgo-free-structured-output",
    "high",
    '{"harness":"search-agent"}',
    "resolved",
    0.7,
    "source_verified_review_required",
    "2026-10-26T12:30:00.000Z",
    '{"legacy":"search"}'
  );
  db.exec(`
    INSERT INTO model_benchmark_search_evidence VALUES (
      'hash-collision-valid', 'other', 'swe-bench', 'SWE-bench Verified', '1',
      'high', '{"harness":"agent-fallback"}', 'resolved', 0.55, 'v1',
      'other', 'Other Model', 'https://example.test/benchmark', '2026-10-27',
      'verified', '2026-10-27T00:00:00.000Z', '{"legacy":"valid"}'
    );
    INSERT INTO model_benchmark_search_evidence VALUES (
      'hash-collision-invalid', 'swe-bench', 'swe-bench', 'SWE-bench Verified', '1',
      'high', '{"harness":"agent-fallback"}', 'resolved', NULL, 'v1',
      'swe-bench', 'SWE Bench Model', 'https://example.test/benchmark', '2026-10-27',
      'verified', '2026-10-28T00:00:00.000Z', '{"legacy":"invalid"}'
    );
  `);
  const legacy = db
    .prepare(
      "SELECT * FROM model_benchmark_search_evidence ORDER BY model_id, captured_at DESC, evidence_hash"
    )
    .all();
  const migration = fs.readFileSync(
    path.resolve("src/lib/db/migrations/216_model_benchmark_evidence_current_set.sql"),
    "utf8"
  );
  db.transaction(() => {
    db.exec(migration);
    migrationRunner.compactLegacyModelBenchmarkEvidence(db);
  })();

  const rows = db.prepare("SELECT * FROM model_benchmark_evidence ORDER BY evidence_hash").all();
  assert.equal(rows.length, 6);
  assert.equal("raw_json" in rows[0], false);
  assert.deepEqual(
    rows.map((row) => [
      row.evidence_hash,
      row.source,
      row.model_id,
      row.benchmark,
      row.reasoning_effort,
      row.reasoning_config_json,
      row.value,
    ]),
    [
      [
        "hash-collision-invalid",
        "swe-bench",
        "swe-bench",
        "SWE-bench Verified",
        "high",
        '{"harness":"agent-fallback"}',
        null,
      ],
      [
        "hash-collision-valid",
        "swe-bench",
        "other",
        "SWE-bench Verified",
        "high",
        '{"harness":"agent-fallback"}',
        0.55,
      ],
      [
        "hash-hf",
        "huggingface-eval-results",
        "legacy-model",
        "SWE-bench Verified",
        "medium",
        '{"harness":"hf-agent"}',
        0.6,
      ],
      [
        "hash-low",
        "swe-bench",
        "legacy-model",
        "SWE-bench Verified",
        "low",
        '{"harness":"agent-a"}',
        0.4,
      ],
      [
        "hash-search",
        "duckduckgo-free-structured-output",
        "legacy-model",
        "SWE-bench Verified",
        "high",
        '{"harness":"search-agent"}',
        0.7,
      ],
      [
        "hash-tie-z",
        "swe-bench",
        "legacy-model",
        "SWE-bench Verified",
        "high",
        '{"tier":{"b":2,"a":1},"harness":"agent-b"}',
        0.9,
      ],
    ]
  );
  const { getEligibleModelBenchmarkFitnessObservations } =
    await import("../../src/lib/modelBenchmarkFitnessSync.ts");
  const { computeModelBenchmarkFitness } = await import("../../src/lib/modelBenchmarkFitness.ts");
  const formulaRows = (items) =>
    items.map((row) => ({
      modelId: row.model_id,
      source: row.source,
      benchmark: row.benchmark,
      benchmarkVersion: row.benchmark_version,
      reasoningEffort: row.reasoning_effort,
      reasoningConfig: JSON.parse(row.reasoning_config_json),
      metric: row.metric,
      value: row.value,
      verificationStatus: row.verification_status,
    }));
  const previousScores = computeModelBenchmarkFitness(
    getEligibleModelBenchmarkFitnessObservations(formulaRows(legacy)),
    ["legacy-model", "other", "swe-bench"]
  );
  const migratedScores = computeModelBenchmarkFitness(
    getEligibleModelBenchmarkFitnessObservations(formulaRows(rows)),
    ["legacy-model", "other", "swe-bench"]
  );
  assert.deepEqual(migratedScores, previousScores);
  assert.equal(getEligibleModelBenchmarkFitnessObservations(formulaRows(rows)).length, 5);
  assert.deepEqual(
    db
      .prepare("PRAGMA foreign_key_list(model_benchmark_evidence)")
      .all()
      .map((item) => [item.table, item.from, item.to, item.on_delete]),
    [["model_benchmark_search_models", "model_id", "model_id", "CASCADE"]]
  );
  assert.equal(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?")
      .get("idx_model_benchmark_search_evidence_model") !== undefined,
    true
  );
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO model_benchmark_evidence (evidence_hash, model_id, source) VALUES (?, ?, ?)"
      )
      .run("hash-tie-z", "legacy-model", "swe-bench")
  );
  db.prepare("DELETE FROM model_benchmark_search_models").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM model_benchmark_evidence").get().count, 0);
  db.close();
});

test("successful source replacement removes changed and deleted rows while retaining distinct current observations", () => {
  searchDb.enqueueModelBenchmarkSearches([{ id: "raw-model", name: "Raw Model" }]);
  const rows = [
    currentEvidence("raw-model", "swe-bench", "pass@1", 0.5, "low", "agent-a"),
    currentEvidence("raw-model", "swe-bench", "pass@1", 0.6, "high", "agent-a"),
    currentEvidence("raw-model", "swe-bench", "pass@1", 0.7, "high", "agent-b"),
  ];
  searchDb.replaceModelBenchmarkEvidenceSource("raw-model", "swe-bench", rows);
  assert.equal(searchDb.listAllModelBenchmarkSearchEvidence().length, 3);

  const next = [currentEvidence("raw-model", "swe-bench", "pass@1", 0.8, "high", "agent-a")];
  searchDb.replaceModelBenchmarkEvidenceSource("raw-model", "swe-bench", next);
  const current = searchDb.listAllModelBenchmarkSearchEvidence();
  assert.equal(current.length, 1);
  assert.equal(current[0].value, 0.8);
  assert.equal("raw" in current[0], false);
  const rowCount = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) AS count FROM model_benchmark_evidence")
    .get().count;
  searchDb.replaceModelBenchmarkEvidenceSource("raw-model", "swe-bench", next);
  assert.equal(
    core.getDbInstance().prepare("SELECT COUNT(*) AS count FROM model_benchmark_evidence").get()
      .count,
    rowCount
  );

  assert.throws(() =>
    searchDb.replaceModelBenchmarkEvidenceSources([
      {
        modelId: "raw-model",
        source: "swe-bench",
        rows: [currentEvidence("other-model", "swe-bench", "pass@1", 0.1, "low", "bad")],
      },
    ])
  );
  assert.equal(searchDb.listAllModelBenchmarkSearchEvidence().length, 1);
  searchDb.replaceModelBenchmarkEvidenceSource("raw-model", "swe-bench", []);
  assert.equal(searchDb.listAllModelBenchmarkSearchEvidence().length, 0);
});

test("source replacement rolls back evidence when afterReplace throws", () => {
  searchDb.enqueueModelBenchmarkSearches([{ id: "rollback-model", name: "Rollback Model" }]);
  const original = currentEvidence("rollback-model", "swe-bench", "pass@1", 0.5, "high", "h1");
  searchDb.replaceModelBenchmarkEvidenceSource("rollback-model", "swe-bench", [original]);

  assert.throws(
    () =>
      searchDb.replaceModelBenchmarkEvidenceSources(
        [
          {
            modelId: "rollback-model",
            source: "swe-bench",
            rows: [currentEvidence("rollback-model", "swe-bench", "pass@1", 0.9, "high", "h1")],
          },
        ],
        () => {
          throw new Error("publish failed");
        }
      ),
    /publish failed/
  );
  assert.equal(searchDb.listAllModelBenchmarkSearchEvidence()[0].value, 0.5);
});

test("duplicate hashes reject replacement without deleting current evidence", () => {
  searchDb.enqueueModelBenchmarkSearches([
    { id: "duplicate-model", name: "Duplicate Model" },
    { id: "collision-model", name: "Collision Model" },
  ]);
  const original = currentEvidence("duplicate-model", "swe-bench", "pass@1", 0.5, "high", "h1");
  searchDb.replaceModelBenchmarkEvidenceSource("duplicate-model", "swe-bench", [original]);
  const first = currentEvidence("duplicate-model", "swe-bench", "pass@1", 0.7, "high", "h1");
  const duplicate = currentEvidence("duplicate-model", "swe-bench", "pass@1", 0.8, "high", "h1");
  duplicate.evidenceHash = first.evidenceHash;

  assert.throws(
    () =>
      searchDb.replaceModelBenchmarkEvidenceSource("duplicate-model", "swe-bench", [
        first,
        duplicate,
      ]),
    /Duplicate evidence hash/
  );
  assert.equal(searchDb.listAllModelBenchmarkSearchEvidence()[0].value, 0.5);

  const outsideCollision = currentEvidence(
    "collision-model",
    "swe-bench",
    "pass@1",
    0.2,
    "low",
    "h2"
  );
  outsideCollision.evidenceHash = "outside-collision";
  searchDb.replaceModelBenchmarkEvidenceSource("collision-model", "swe-bench", [outsideCollision]);
  const colliding = currentEvidence("duplicate-model", "swe-bench", "pass@1", 0.9, "high", "h3");
  colliding.evidenceHash = "outside-collision";
  assert.throws(() =>
    searchDb.replaceModelBenchmarkEvidenceSource("duplicate-model", "swe-bench", [colliding])
  );
  assert.equal(
    searchDb
      .listAllModelBenchmarkSearchEvidence()
      .find(({ modelId }) => modelId === "duplicate-model")?.value,
    0.5
  );
});

function currentEvidence(
  modelId: string,
  source: string,
  metric: string,
  value: number,
  effort: string,
  harness: string
) {
  return {
    evidenceHash: `${modelId}:${source}:${metric}:${effort}:${harness}`,
    modelId,
    source,
    sourceVersion: "v1",
    matchedModelId: modelId,
    matchedModelName: modelId,
    benchmark: "SWE-bench",
    benchmarkVersion: "2",
    reasoningEffort: effort,
    reasoningConfig: { harness },
    metric,
    value,
    sourceUrl: "https://example.test/source",
    sourceDate: "2026-10-27",
    verificationStatus: "verified",
    capturedAt: new Date().toISOString(),
  };
}
