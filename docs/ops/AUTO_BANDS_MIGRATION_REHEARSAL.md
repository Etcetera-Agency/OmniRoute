---
title: "FMO Migration Ledger Rehearsal"
lastUpdated: 2026-10-03
---

# One-Time FMO Migration Ledger Rekey

This runbook covers the one-time ledger repair needed when the fork's FMO migrations share numeric ledger slots with upstream migrations 164–166. It records a copy-only rehearsal against upstream commit `23a11484862b3bb589a55e85b00e4ac53ffeb234` (`release/v3.8.52`). It does not add runtime compatibility behavior.

The rehearsal passed database initialization and migration checks on an isolated, consistent database copy. It did not modify the live database or restart the live service. The separate Node 24 Next.js build did not complete, so it is not a build/start pass. Two Node 26 builds of staged commit `db18a17c374506941d10fbc58132eb108d1ea5db` failed from memory pressure: attempt 1 reported builder `OOM=true`; attempt 2 exhausted the V8 heap near 4066 MB and aborted with `SIGABRT`, without a new cgroup OOM event. Attempt 3 (03:49:15–03:58:53 UTC) exited 1 as `CANCELED` / `context canceled`, not OOM. The watcher incorrectly treated an approved 9.5-GiB same-container update as a replacement because it expected exactly 9 GiB, then canceled the build. No attempt produced an image or ran cutover/migration. Retry 4 ran 04:03:26–04:12:29 UTC after preflight reported 27,403,431,936 bytes free disk and 15,284,174,848 bytes `MemAvailable`. A read-only watcher dry run verified the exact container ID, limits, source, and digests. It used 10 GiB total memory-plus-swap from startup, heap 6144 MiB, two workers, webpack, cpuset 0, pids 512, and 900 seconds. A cgroup OOM event occurred at 04:12:22 UTC; the Next worker was SIGKILLed at 535 seconds, builder memory peaked at 9.999/10 GiB, and the build exited 1. Host and disk floors remained clear. No image or start result was produced. The 2-GiB host and 14-GiB disk floors above describe historical attempts only; they are not requirements for the later build. Production was then at `f2bddef27ed0807dd5a5e2712bc26536edda8138`; the candidate later passed Node 26 build/start and migration checks against a fresh isolated production-data copy, and the authorized production migration/cutover later completed as documented below. Node 24 remains a separate portability baseline, not a production-runtime requirement. The user authorized the production ledger repair; it was executed after candidate verification and a fresh consistent backup.

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

During this one-time ledger rekey, do not delete or rewrite the FMO tables, change the preserved migration names, set `applied_at` again, or add the legacy strings to application code. This is not a compatibility bridge; any future orphan-table cleanup is a separate operation.

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

Two Node 26 builds of staged commit `db18a17c374506941d10fbc58132eb108d1ea5db` also failed. Attempt 1 ran 02:57:04–03:08:36 UTC with a 7-GiB total RAM/swap bound, cpuset 0, and pids limit 512; `npm run build` exited 1 at webpack step 19 and builder inspection reported `OOM=true`. Logs and diagnostics were retained. Attempt 2 ran 03:26:10–03:34:11 UTC with heap limit 4096 MiB, the same 7-GiB total RAM/swap bound, cpuset 0, pids limit 512, and cached dependencies. It exited 1 after V8 heap exhaustion near 4066 MB and `SIGABRT`; no new cgroup OOM event was recorded. Retry logs and events were retained. Neither attempt produced an image or ran production cutover/migration; at that time, the production source/container remained at `f2bddef27ed0807dd5a5e2712bc26536edda8138`.

A third diagnostic build launched at 03:49:15 UTC after its disk and memory preflight passed, but the watcher canceled it at 03:58:53 UTC after misclassifying an approved 9.5-GiB same-container update as a builder replacement. It exited as `CANCELED` / `context canceled`, not OOM. Retry 4 ran 04:03:26–04:12:29 UTC after preflight reported 27,403,431,936 bytes free disk and 15,284,174,848 bytes `MemAvailable`. A read-only watcher dry run verified the exact container ID, limits, source, and digests. Retry 4 used 10 GiB total memory-plus-swap from startup, heap 6144 MiB, two workers, webpack, cpuset 0, pids 512, and 900 seconds. A cgroup OOM event occurred at 04:12:22 UTC; the Next worker was SIGKILLed at 535 seconds, builder memory peaked at 9.999/10 GiB, and the build exited 1. Host and disk floors remained clear. No image or start result was produced. The earlier isolated 1.119-GB npm download cache was removed; the 4.242-GB existing npm cache layer was preserved and reused. At that point, production remained at `f2bddef27ed0807dd5a5e2712bc26536edda8138`; no production database or service change had occurred. These historical build failures predate the official-UI/backend-overlay candidate, whose exact Node 26 build/start and isolated-copy migration checks later passed as documented below. At that point production migration and cutover were pending; the later production operation is recorded below.

A later full-UI Node 26 `runner-base` reproduction used the documented
12-GiB profile on the staged exact SHA: heap 6144 MiB, two workers, and
`OMNIROUTE_USE_TURBOPACK=0`. Post-stop resource guards passed, but a cgroup OOM
occurred at 07:55:44 UTC; the Next worker was SIGKILLed at 687.8 seconds and the
build exited 1 at 07:55:48 UTC without an image. The restoration watchdog
returned the old f2 container to healthy at 07:56:19 UTC after a 12m04s
OmniRoute-only outage. Redis remained healthy; no production DB/Radar changes or
cutover occurred. The old f2 revision passed the same 12-GiB profile, but staged
db18 did not. User decision is to set production `cache.maxMemoryGenerations=0`
constantly without a feature flag; the setting was implemented, reviewed, and published in source commit
`4b29aa12fcc51fb183b196b67f878fb8ca67b5b2`. The production callback smoke
and `node --check` passed; it was exercised on the backend-only compile. The setting disables additional memory-cache
generations but does not bound the live compiler object graph, so it cannot
guarantee a 12-GiB fit ([Webpack cache
docs](https://webpack.js.org/configuration/cache/#cachemaxmemorygenerations)).
Next 16.3.5 sets production `Infinity` before the custom callback; reverify that
the callback reapplies `0` after each framework upgrade. The candidate passed
build/start and migration checks against a fresh isolated production-data copy.
Production migration and cutover later completed as recorded below.

The published candidate uses the attested official UI image plus a backend-only overlay. `maxMemoryGenerations=0` behavior was exercised on that backend-only compile; its effect on a full-UI webpack build and a 12-GiB full-build fit remain unmeasured. Do not claim the cache setting makes full-UI builds fit. If a future delivery requires rebuilding the dashboard, measure the full target in a separately approved follow-up.

### Backend-overlay rollout status

The official Node 26 / Next 16.3.5 linux/arm64 base for upstream
`23a11484862b3bb589a55e85b00e4ac53ffeb234` passed native and filesystem
inspection at `sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
Its SLSA attestation binds the source; OCI revision/version labels are absent.
Source A `4b29aa12fcc51fb183b196b67f878fb8ca67b5b2` compiled successfully in 733.7 seconds. The full scratch
export was canceled at 09:16:03 UTC because it was exporting unneeded cache
data, not because compilation failed. A cached thin export completed in 1.6
seconds: 232,614,811 bytes total, including 3,529 server files / 232,234,534
bytes, a 193,684-byte routes manifest, and a 27,866-byte required-server-files
manifest. It contains no standalone app, static assets, cache, or `node_modules`.
Thin-export and route/bundle hashes were verified against the final image; an
aggregate artifact/image digest was not reported.

Source B `55f40468137290e8efdc24a1a1b95b111a61d91a` produced `omniroute:55f40468-official-overlay` from the pinned base and prebuilt backend
pack. Target BuildKit parse and image import passed without recompilation. Native
checks passed for Node 26.10.0, Next 16.3.5, and SQLite 3.53.4. All 1,089
static assets, the Next build-identifier file, and 159 non-API app-path entries match the base
hashes; the merged manifest has 725 API routes, 9 API function configs, and 16
rewrites. Source A plus pack B runtime compatibility was verified. The candidate
container was healthy and `/dashboard/radar` returned 200. SystemOne paths
returned handler-specific `unknown_route` 404 only with both feature and auth
disabled; this does not verify enabled routes. A fresh 112,594,944-byte
production-data copy passed `quick_check` before rekey. The exact three-row
ledger rekey preserved all other migration rows, original FMO names/timestamps,
eight FMO schema objects, table counts (5/45/1/1), and all four table SHA-256
values. Candidate startup applied the missing migrations through version 196;
after correcting a boolean in the isolated smoke input, the second startup was
healthy with 196 applied, zero pending, and zero newly applied migrations.
Final integrity and foreign-key checks passed. Unauthenticated `GET
/v1/models` returned the expected `401 AUTH_002`; authenticated `/v1` dispatch
and enabled SystemOne/bands route checks remain pending. The copy's Radar probe
returned 404 with Radar disabled.

The authorized production cutover now serves `omniroute:55f40468-official-overlay`,
image ID `sha256:bfb397b394e6f646583355dbe26bbb879cca2efddef140f786558519eedc4668`,
from source B `55f40468137290e8efdc24a1a1b95b111a61d91a` and runtime-equivalent
backend artifact A `4b29aa12fcc51fb183b196b67f878fb8ca67b5b2`. A fresh
112,594,944-byte backup at
`/opt/apps/omniroute-deploy-diagnostics/prod-cutover-55f40468-20261003T095314Z/backup/storage.sqlite`
passed `quick_check` (SHA-256
`d2c5149efb1272edadb09b5ba93378986f71f3943373ee5783dad9f728c901a6`); the
exact three-row ledger rekey was committed after the backup and before
candidate startup. The app applied 33 migrations and was healthy at 09:58 UTC;
Redis was healthy. The
post-migration check passed integrity `ok`, zero foreign-key violations, 196
ledger rows (193 numeric plus three legacy rows), max numeric version 196,
exact upstream 164–166 records, preserved legacy names/timestamps, required
retirement triggers, and FMO counts 5/45/1/1. Unauthenticated production
`GET /v1/models` returned `401 AUTH_002`. Radar is enabled and public-catalog
opt-in is true. Authenticated settings/status calls returned HTTP 200. A public
sync request returned HTTP 200, but status reports `Feed request failed with
status 404`; all four Radar caches remain empty. The default
`https://radar.omniroute.online/v1/catalog/latest` returns Vercel
`deployment-not-found` with the correct schema header and without a bearer
token. The built-in catalog's 489 entries do not prove feed data was loaded.
Restore the external Radar service/domain or configure a verified live
`RADAR_FEED_URL` before retrying; this repository has no private server source
or access, only its public export workflow. Earlier unauthenticated probes
confirmed route/port mapping: on UI port 20128, `/dashboard/radar` redirects to
login and `/api/radar/settings` plus `/api/radar/status` return `401 AUTH_001`;
on API port 20129, `/v1/radar/settings` returns `401 AUTH_002`. The earlier
`not_found` came from probing the wrong port. Other authenticated routes, live
catalog/calibration, band, reserve, and SystemOne checks are not complete. No
FMO tables were dropped; revalidate the base digest and attestation on every
Next upgrade.

## Production closeout

The candidate is serving production and its migration/integrity checks passed. Retain the pre-change backup according to the production retention policy and keep the authorization reference, backup, migration summary, and integrity result in the protected operations record; do not copy database contents into this repository. Do not repeat the ledger rekey. Finish authenticated route validation and resolve the public Radar sync error, then verify feed/cache state; keep live calibration, routing, reserve, and SystemOne checks open.

If a precondition or row-count assertion fails, roll back the transaction and stop. If a failure occurs after commit but before the application migration succeeds, keep OmniRoute stopped and use the approved recovery plan with the untouched pre-change backup. Do not run an inverse ledger update or repeatedly retry startup against an uncertain database state.
