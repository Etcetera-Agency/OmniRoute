---
title: "FMO Migration Ledger Rehearsal"
lastUpdated: 2026-10-03
---

# One-Time FMO Migration Ledger Rekey

This runbook covers the one-time ledger repair needed when the fork's FMO migrations share numeric ledger slots with upstream migrations 164–166. It records a copy-only rehearsal against upstream commit `23a11484862b3bb589a55e85b00e4ac53ffeb234` (`release/v3.8.52`). It does not add runtime compatibility behavior.

The rehearsal passed database initialization and migration checks on an isolated, consistent database copy. It did not modify the live database or restart the live service. The separate Node 24 Next.js build did not complete, so it is not a build/start pass. Two Node 26 builds of staged commit `db18a17c374506941d10fbc58132eb108d1ea5db` failed from memory pressure: attempt 1 reported builder `OOM=true`; attempt 2 exhausted the V8 heap near 4066 MB and aborted with `SIGABRT`, without a new cgroup OOM event. Attempt 3 (03:49:15–03:58:53 UTC) exited 1 as `CANCELED` / `context canceled`, not OOM. The watcher incorrectly treated an approved 9.5-GiB same-container update as a replacement because it expected exactly 9 GiB, then canceled the build. No attempt produced an image or ran cutover/migration. Retry 4 ran 04:03:26–04:12:29 UTC after preflight reported 27,403,431,936 bytes free disk and 15,284,174,848 bytes `MemAvailable`. A read-only watcher dry run verified the exact container ID, limits, source, and digests. It used 10 GiB total memory-plus-swap from startup, heap 6144 MiB, two workers, webpack, cpuset 0, pids 512, and 900 seconds. A cgroup OOM event occurred at 04:12:22 UTC; the Next worker was SIGKILLed at 535 seconds, builder memory peaked at 9.999/10 GiB, and the build exited 1. Host and disk floors remained clear. No image or start result was produced. Preserve 2-GiB host and 14-GiB disk hard floors. Production remains at `f2bddef27ed0807dd5a5e2712bc26536edda8138`, with no database or service changes. The exact reviewed release still needs a successful Node 26 build/start against a fresh isolated copy. Node 24 remains a separate portability baseline, not a production-runtime requirement. The user has authorized this production ledger repair; execute it only after successful exact-commit build/start and a fresh verified backup.

## Collision and repair

The fork recorded its FMO migrations under the same numeric keys that upstream uses for provider retirement. The upstream runner considers an exact version string applied; renaming only the fork's ledger key frees the upstream slot while preserving the original migration name and timestamp.

| Existing `version` | Preserved `name`     | New one-time `version`          | Upstream migration freed            |
| ------------------ | -------------------- | ------------------------------- | ----------------------------------- |
| `164`              | `fmo_pools`          | `legacy-164-fmo_pools`          | `164_retire_microsoft_designer_web` |
| `165`              | `fmo_pool_decisions` | `legacy-165-fmo_pool_decisions` | `165_retire_felo_web`               |
| `166`              | `fmo_pool_live_seam` | `legacy-166-fmo_pool_live_seam` | `166_retire_gpl_derived_providers`  |

The ledger is `_omniroute_migrations`; `version` is a `TEXT PRIMARY KEY`, and `name` and `applied_at` are non-null. The rekey changes only `version`. It preserves each old row's `name` and `applied_at` and leaves the FMO tables and their records intact.

The textual `legacy-…` keys do not parse as numbers with `Number.parseInt`. The runner filters non-numeric values from its numeric high-water calculation and matches applied migration versions as exact strings. After the rekey, upstream 164–166 become pending. In the rehearsal, the numeric maximum moved from 166 to 163 before initialization. The runner first reconciled the already-applied `163_model_capabilities` record to upstream `169_model_capabilities`, then applied the three retirement migrations; no mapping for the FMO keys was added. The runner's final summary reported 33 migration operations: 27 SQL migration applications and six existing-column markers. A second initialization found no pending migrations and applied nothing. No permanent mapping or runtime fallback for the FMO keys is needed.

## Preconditions

Before a production change:

1. Use this procedure only for the user-authorized rollout. Schedule the production maintenance window and confirm the application writers can be quiesced.
2. Verify the exact target commit has passed the supported Node 26 build/start smoke on an isolated copy, and verify its upstream migration files match the rehearsed migration set. The recorded migration rehearsal used upstream commit `23a11484862b3bb589a55e85b00e4ac53ffeb234`, Node `v24.15.0`, and the `node:sqlite` fallback; that historical runtime fact does not require Node 24 for production.
3. Quiesce OmniRoute writers before changing the live ledger so startup cannot race the rekey or run migrations concurrently.
4. Create a fresh, restricted, consistent SQLite backup with SQLite's backup operation. Keep the original backup untouched and confirm `PRAGMA quick_check` returns `ok` on it. Do not copy only the main database file while WAL writes may be in flight.
5. Confirm `_omniroute_migrations` has the expected columns and that each exact `(version, name)` pair in the table above occurs once. Confirm all three target `legacy-…` keys are absent. Stop on any mismatch; never infer a repair from version numbers alone.

## One-time transaction

Run the update through a SQLite client that can check affected-row counts inside one `BEGIN IMMEDIATE` transaction. Capture the three original `applied_at` values in memory before updating; do not print or export unrelated database rows.

```text
assert working database is a separate copy of the protected backup
assert PRAGMA quick_check == "ok"
assert ledger schema is _omniroute_migrations(version TEXT PRIMARY KEY,
                                               name TEXT NOT NULL,
                                               applied_at TEXT NOT NULL)
assert each old (version, name) pair occurs exactly once
assert each new legacy version is absent

BEGIN IMMEDIATE
for each approved mapping:
    UPDATE _omniroute_migrations
       SET version = :legacy_version
     WHERE version = :old_version AND name = :original_name
    assert affected_rows == 1
    assert name and applied_at still equal their captured values

assert no rows remain under numeric versions 164, 165, or 166
assert every ledger row except the three version values is unchanged
assert FMO schema is unchanged
COMMIT

if any assertion fails before COMMIT:
    ROLLBACK
assert PRAGMA quick_check == "ok"
```

Do not delete or rewrite the FMO tables, change the preserved migration names, set `applied_at` again, or add the legacy strings to application code. This is a one-time ledger rekey, not a compatibility bridge.

## First initialization checks

Start only the exact rehearsed source against the repaired copy, with background services, credential health checks, and external networking disabled. Verify all of the following before considering a production start:

- The upstream rows are recorded with the exact names `164_retire_microsoft_designer_web`, `165_retire_felo_web`, and `166_retire_gpl_derived_providers`.
- The three `legacy-…` rows retain their original FMO names and `applied_at` values.
- The runner applies the pending migrations in numeric order and records each version/name pair. Review the exact expected pending set, including already-applied renamed migrations and existing-column markers; do not assume the range is always 164–196.
- `PRAGMA quick_check` returns `ok` after initialization.
- Every FMO table, schema object, and row count matches the pre-initialization copy.
- Rows targeted by the retirement migrations satisfy their disabled/tombstoned state, and no active exclusive lease remains for those providers or their connections.
- Required retirement triggers are present. Exercise provider insertion/reactivation and lease insertion/reactivation inside a savepoint; check fail-closed behavior, then roll back the savepoint and confirm no probe rows remain.

Migration 164 installs four Microsoft Designer Web provider/lease triggers; migration 165 installs six Felo provider/lease and identity-preservation triggers. Migration 166 retires its existing provider rows and active leases through the migration itself and installs no persistent trigger. Keep verification output to aggregate counts and migration names; do not log credentials, provider connection IDs, or database row contents.

## Copy rehearsal record

On 2026-10-03, a SQLite-consistent production snapshot was copied to a disposable working database. The live source was read-only throughout. The copy passed `PRAGMA quick_check` before the rekey. The transaction changed only the three ledger version strings; it preserved the other ledger rows, all three original names and timestamps, and the four FMO schema objects.

The exact upstream migration runner ran under Node `v24.15.0` with `node:sqlite` because install scripts were disabled in the isolated dependency install. This records the copy-rehearsal runtime only; it is not the production image requirement or a completed application build. The first initialization exited successfully. Its runner summary reported 33 operations: 27 SQL migration applications, including upstream 164–168, and six “column pre-exists” markers. It also reconciled the pre-existing `163_model_capabilities` record to version 169. The FMO schema and table counts were unchanged:

| FMO table                    | Before | After first init | After second init |
| ---------------------------- | -----: | ---------------: | ----------------: |
| `fmo_pool_specs`             |      5 |                5 |                 5 |
| `fmo_pool_decisions`         |     45 |               45 |                45 |
| `fmo_pool_apply_marker`      |      1 |                1 |                 1 |
| `fmo_pool_generation_marker` |      1 |                1 |                 1 |

The snapshot had no existing rows for the three retired provider families and no active matching leases; provider-row retirement checks therefore had zero violations. The four migration-164 triggers and six migration-165 triggers were present. Savepoint-only probes confirmed their provider-insert, reactivation, identity-preservation, and lease-invalidation behavior. All synthetic rows were rolled back. `PRAGMA quick_check` returned `ok` before rekey, after both initializations, and after the trigger probes.

A second, separate Node 24.15 process reported 196 applied migrations, zero pending migrations, no newly applied migration rows, unchanged FMO table counts, and `PRAGMA quick_check = ok`. This verifies the rekey and initialization are idempotent on the rehearsed copy.

The database runner used an isolated container with `--network none`, a read-only source mount, and `DATA_DIR` pointed at the disposable copy; `OMNIROUTE_SKIP_DB_HEALTHCHECK`, `OMNIROUTE_DISABLE_BACKGROUND_SERVICES`, and `OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK` were set for the copy-only process. The separate Node 24.15 Next.js production build used two CPUs, a 6-GiB memory cap, a 512-process cap, no network, and no database or production mounts. It stopped during “Creating an optimized production build”; it produced no usable build and no Next.js start result. Its temporary container used automatic removal, and no retained Docker inspection, event, or task-filtered daemon-journal record exposes that attempt's exit cause.

Two Node 26 builds of staged commit `db18a17c374506941d10fbc58132eb108d1ea5db` also failed. Attempt 1 ran 02:57:04–03:08:36 UTC with a 7-GiB total RAM/swap bound, cpuset 0, and pids limit 512; `npm run build` exited 1 at webpack step 19 and builder inspection reported `OOM=true`. Logs and diagnostics were retained. Attempt 2 ran 03:26:10–03:34:11 UTC with heap limit 4096 MiB, the same 7-GiB total RAM/swap bound, cpuset 0, pids limit 512, and cached dependencies. It exited 1 after V8 heap exhaustion near 4066 MB and `SIGABRT`; no new cgroup OOM event was recorded. Retry logs and events were retained. Neither attempt produced an image or ran production cutover/migration; the production source/container remains at `f2bddef27ed0807dd5a5e2712bc26536edda8138`.

A third diagnostic build launched at 03:49:15 UTC after its disk and memory preflight passed, but the watcher canceled it at 03:58:53 UTC after misclassifying an approved 9.5-GiB same-container update as a builder replacement. It exited as `CANCELED` / `context canceled`, not OOM. Retry 4 ran 04:03:26–04:12:29 UTC after preflight reported 27,403,431,936 bytes free disk and 15,284,174,848 bytes `MemAvailable`. A read-only watcher dry run verified the exact container ID, limits, source, and digests. Retry 4 used 10 GiB total memory-plus-swap from startup, heap 6144 MiB, two workers, webpack, cpuset 0, pids 512, and 900 seconds. A cgroup OOM event occurred at 04:12:22 UTC; the Next worker was SIGKILLed at 535 seconds, builder memory peaked at 9.999/10 GiB, and the build exited 1. Host and disk floors remained clear. No image or start result was produced. The earlier isolated 1.119-GB npm download cache was removed; the 4.242-GB existing npm cache layer was preserved and reused. Production remains at `f2bddef27ed0807dd5a5e2712bc26536edda8138`; no production database or service change occurred. Do not treat either migration rehearsal as a build or startup pass. Production remains gated on a successful bounded Node 26 build/start for the exact reviewed release commit.

## Production closeout

After the successful exact-commit build/start gate and the authorized one-time production repair, retain the pre-change backup according to the production retention policy. Confirm the repaired ledger and upstream postconditions using aggregate queries, then start OmniRoute once and verify a second read-only migration-status check reports zero pending migrations. Keep the authorization reference, backup, migration summary, and integrity result in the protected operations record; do not copy database contents into this repository.

If a precondition or row-count assertion fails, roll back the transaction and stop. If a failure occurs after commit but before the application migration succeeds, keep OmniRoute stopped and use the approved recovery plan with the untouched pre-change backup. Do not run an inverse ledger update or repeatedly retry startup against an uncertain database state.
