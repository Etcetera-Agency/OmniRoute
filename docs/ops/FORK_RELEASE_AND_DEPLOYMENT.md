---
title: "OmniRoute Fork Release and Deployment"
lastUpdated: 2026-10-03
---

# OmniRoute Fork Release and Deployment

This guide is the release and server-deployment procedure for the OmniRoute
fork carrying auto quality bands. Routine tests and static checks run only when
a specific task calls for them. The only automatic GitHub workflow builds and
verifies the fork image on canonical `main` pushes; it can also be started
manually on exact `main`. Production pulls the image by verified digest through
Docker Compose; the server does not build application source.

## Pinned baseline

| Ref                        | Value                                           |
| -------------------------- | ----------------------------------------------- |
| Upstream                   | `https://github.com/diegosouzapw/OmniRoute.git` |
| Baseline branch            | `release/v3.8.52`                               |
| Baseline commit            | `23a11484862b3bb589a55e85b00e4ac53ffeb234`      |
| Fork implementation branch | `feat/auto-quality-bands`                       |

The baseline commit is immutable history for this implementation branch. Keep
fork-only `openspec/` content when rebasing. Do not add compatibility code for
older upstream layouts unless separately requested.

## Rebase onto a newer upstream tag

Rebase the feature branch onto an upstream release tag. Set `old_upstream_tag`
to the tag used as the branch's current upstream base, which must resolve to the
pinned base commit, and `new_upstream_tag` to the approved next upstream release
tag. Verify both refs before changing history. Rebasing rewrites branch history;
get explicit approval before performing it.

```bash
old_upstream_tag='REPLACE_WITH_CURRENT_BASE_TAG'
new_upstream_tag='REPLACE_WITH_APPROVED_NEXT_TAG'

git remote -v
git fetch upstream --tags
git show --no-patch --format='%H %D' "$old_upstream_tag"
git show --no-patch --format='%H %D' "$new_upstream_tag"
git switch feat/auto-quality-bands
git status --short
git rebase --onto "$new_upstream_tag" "$old_upstream_tag" feat/auto-quality-bands
```

Require a clean working tree before rebasing. Resolve conflicts against the new
upstream contracts, then inspect the fork-only diff. Run task-specific tests or
static checks manually only when the current task calls for them; the main image
workflow verifies its built container before publication. Do not merge upstream
`main` as a substitute for this tag-based rebase. Any push of the rewritten
branch requires explicit user approval; if approved, push only
`feat/auto-quality-bands` with lease protection. A merge to `main` also
requires explicit approval.

## Historical production-promotion evidence and open follow-up

The evidence below records the initial production rollout. It is historical
operator context, not a recurring or automated test gate. The production ledger
conflict had an approved one-time repair, which is complete as recorded below;
do not repeat its ledger rekey.

- Rebased branch matches the selected upstream tag and has no unintended fork
  delta.
- Band grammar, identity, seam, filter, calibration, reserve, and unmodified
  upstream `autoCombo` tests pass. Typecheck, scoped lint, and formatting pass.
- Independent review findings are fixed and closed. The final-selection and
  quota-cutoff routing findings, five calibration findings, reserve review,
  and SystemOne review are closed; this does not replace live verification.
- The exact release commit runs as an API backend overlay on the pinned stock
  Node 26 UI image and starts against a fresh, consistent, isolated
  production-database copy. Record startup and
  migration output; never use the live mounted database for this check.
- With `OMNIROUTE_AUTO_BANDS` unset and with it set to `0`, verify the full
  upstream-routing fallback: band quality/capability filters, band ordering,
  and reserve/account narrowing are bypassed.
- The live combo identity check remains tracked follow-up work; run it as a
  separate task rather than an automatic workflow gate.

### Current validation record

As of 2026-10-03, the final Auto-Combo and service regression passes 41 files /
372 tests with two workers. Core and OpenSSE typechecks pass; scoped ESLint,
Prettier, OpenSpec validation, and changed-doc checks pass. Review closed all
five calibration findings, both routing findings, reserve findings, and the
SystemOne findings. The calibration CLI smoke returned valid JSON for 10
baseline models, 0 rated models, and no cut points on an isolated database; it
does not validate the production catalog. The earlier 20-worker test attempt
was resource-starved; use the passing two-worker run as final evidence.

Two builds of staged commit
`db18a17c374506941d10fbc58132eb108d1ea5db` failed without producing an image.
Attempt 1 ran 02:57:04–03:08:36 UTC with a 7 GiB total RAM/swap bound, cpuset
0, and a 512-process limit. `npm run build` exited 1 at webpack step 19;
builder inspection reported `OOM=true`. Logs and diagnostics were retained.
Attempt 2 ran 03:26:10–03:34:11 UTC with heap limit 4096 MiB, a 7 GiB total
RAM/swap bound, cpuset 0, pids limit 512, and cached dependencies. It exited 1
with V8 heap out-of-memory near 4066 MB and `SIGABRT`; no new cgroup OOM event
was recorded. Retry logs and events were retained. Neither attempt produced an
image; no cutover or production migration ran; at that time, production remained at
`f2bddef27ed0807dd5a5e2712bc26536edda8138`.

A third diagnostic build launched at 03:49:15 and ended at 03:58:53 UTC with
exit 1, `CANCELED` / `context canceled`, not OOM. The watcher expected an exact
9-GiB container value and misclassified an approved 9.5-GiB same-container
resource update as a builder replacement, then canceled the build. This is a
watcher guard defect, not an application compatibility change. Attempt logs
were retained; no image or production DB/service changes resulted.

Retry 4 ran 04:03:26–04:12:29 UTC after preflight reported 27,403,431,936
bytes free disk and 15,284,174,848 bytes `MemAvailable`. A read-only watcher
dry run verified the exact container ID, limits, source, and digests. It used
10 GiB total memory-plus-swap from startup, 6144 MiB Node heap, two workers,
webpack, cpuset 0, pids 512, and 900 seconds. A cgroup OOM event occurred at
04:12:22 UTC; the Next worker was SIGKILLed at 535 seconds, builder memory
peaked at 9.999/10 GiB, and the build exited 1. Host and disk floors remained
clear. No image or start result was produced. The 2-GiB host and 14-GiB disk floors described above applied to those historical attempts only; they are not requirements for the next build. Production remains at
`f2bddef27ed0807dd5a5e2712bc26536edda8138`, and staged source remains
`db18a17c374506941d10fbc58132eb108d1ea5db`.
Retry 5 for staged `db18a17c374506941d10fbc58132eb108d1ea5db` used the
historically passing full-UI profile on the actual Compose `runner-base` target:
pinned Node 26, 12 GiB total, cpuset 0, pids 512, heap 6144 MiB, two workers,
and `OMNIROUTE_USE_TURBOPACK=0`. Post-stop RAM/disk guards and watcher dry run
passed. The build still hit cgroup OOM at 07:55:44 UTC; the Next worker was
SIGKILLed at 687.8 seconds and build exited 1 at 07:55:48 UTC without an image.
The 900-second restoration watchdog recovered the old f2 container, healthy at
07:56:19 UTC after 12m04s of OmniRoute-only outage. Redis stayed healthy; DB,
Radar, and cutover were untouched. The old f2 12-GiB pass does not apply to
staged db18. User decision: apply production `cache.maxMemoryGenerations=0`
constantly, with no feature flag. The owner implemented and reviewed it in this
source commit `4b29aa12fcc51fb183b196b67f878fb8ca67b5b2`; the production
callback smoke and `node --check` passed. This disables additional memory-cache generations but
does not bound the live compiler object graph, so it cannot guarantee a
12-GiB fit ([cache docs](https://webpack.js.org/configuration/cache/#cachemaxmemorygenerations)).
Next 16.3.5 sets production `Infinity` before the custom callback; verify after
each framework upgrade that the callback reapplies `0`. Candidate build/start,
isolated migration, and production cutover have passed. Keep separate Node 24
portability and live-validation checks open.

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
disabled; this does not verify enabled routes. A fresh production-data copy
passed integrity and foreign-key checks, exact ledger rekey, candidate
migration/start, and idempotent second startup. Unauthenticated
`GET /v1/models` returned the expected `401 AUTH_002`; authenticated dispatch
and enabled SystemOne/bands route smoke remain pending. The copy's Radar probe
returned 404 with Radar disabled.

Production now serves `omniroute:55f40468-official-overlay`, built from source
A `4b29aa12fcc51fb183b196b67f878fb8ca67b5b2` and pack B
`55f40468137290e8efdc24a1a1b95b111a61d91a`; immutable image ID is
`sha256:bfb397b394e6f646583355dbe26bbb879cca2efddef140f786558519eedc4668`.
The candidate and Redis are healthy. A fresh 112,594,944-byte backup at
`/opt/apps/omniroute-deploy-diagnostics/prod-cutover-55f40468-20261003T095314Z/backup/storage.sqlite`
passed `quick_check` (SHA-256
`d2c5149efb1272edadb09b5ba93378986f71f3943373ee5783dad9f728c901a6`); the
authorized three-row ledger rekey was committed before candidate startup. The
app applied 33 migrations successfully. Final database checks passed:
integrity `ok`, zero foreign-key violations, 196 ledger rows (193 numeric and
three legacy), maximum numeric version 196, exact upstream 164–166 records,
preserved legacy names/timestamps, required retirement triggers, and FMO table
counts 5/45/1/1. Unauthenticated `GET /v1/models` returned expected
`401 AUTH_002`.

`RADAR_ENABLED` and public-catalog opt-in are true. An authenticated settings
update and status request returned HTTP 200. The public sync request returned
HTTP 200, but status reports `Feed request failed with status 404`; all four
Radar caches are empty. The built-in client defaults to
`https://radar.omniroute.online/v1/catalog/latest`, which returns Vercel
`deployment-not-found` with the correct schema header and without a bearer
token. The 489 built-in catalog entries do not prove a Radar feed was loaded.
Restore the external Radar service/domain or configure a verified live
`RADAR_FEED_URL` before retrying. This repository has no private Radar server
source/access, only the public export workflow. Earlier unauthenticated probes
confirmed the route and port mapping: the public
[Radar dashboard](https://omniroute.etc2nd.etcetera.agency/dashboard/radar)
redirects to login with HTTP 200; on UI port 20128, `/dashboard/radar`
redirects to login and its settings/status APIs return `401 AUTH_001`, while
`/v1/radar/settings` on API port 20129 returns `401 AUTH_002`. The earlier
`not_found` came from probing the wrong port. The supporter Intel key is absent;
the user will enter it through the dashboard as a separate post-deploy action.
Authenticated `/v1` dispatch, enabled SystemOne and band routes, public feed
validation, calibration, routing, reserve, and the successful-chat
`call_logs.combo_name` check remain open. Revalidate the base digest and
attestation on every Next upgrade.

## Production database migration gate

The overlapping migration history has a one-time rekey procedure that passed
an isolated database rehearsal; see
[the FMO migration ledger rehearsal](AUTO_BANDS_MIGRATION_REHEARSAL.md). The
user authorized and the operator completed the production migration for this
rollout after the exact candidate passed official-UI/backend-overlay
build/start on an isolated copy and a fresh consistent backup was verified.
Do not repeat the rekey. The fork uses
migration IDs 164–166 for `fmo_pools`,
`fmo_pool_decisions`, and `fmo_pool_live_seam`; upstream uses those IDs for
`retire_microsoft_designer_web`, `retire_felo_web`, and
`retire_gpl_derived_providers`. Follow the rehearsed transaction and post-init
checks exactly. Do not add permanent migration mappings or compatibility
behavior.

## Verify the production target

The current production SSH target alias is `etc2nd-shlink`. Its host data
directory `/opt/apps/omniroute/data` is mounted at `/app/data`; SQLite is stored
at `/app/data/storage.sqlite` inside the application environment.

The production source checkout `/opt/apps/omniroute/source` and its Git
metadata were verified present and clean at the prior f2 revision
`f2bddef27ed0807dd5a5e2712bc26536edda8138`. The running production container
now uses the candidate image override `omniroute:55f40468-official-overlay`,
built from source A `4b29aa12fcc51fb183b196b67f878fb8ca67b5b2` and pack B
`55f40468137290e8efdc24a1a1b95b111a61d91a`. It was healthy at 09:58 UTC; its
immutable image digest is not yet recorded. The three-row ledger rekey and 33
migrations completed, with post-migration integrity and FMO checks passing.
Authenticated route checks remain open. The Radar path and opt-in are verified;
the sync returns `Feed request failed with status 404` because the default
external endpoint reports `deployment-not-found`. Restore the external service
or configure a verified feed URL. For any future cutover,
verify the live service/container definition, exact commit and image digest,
runtime version, and data mount; record them in the deployment record. Keep the
last known rollback image and database backup intact.

Take a durable database snapshot before deployment. Perform build,
startup, and migration checks against a separate consistent copy. Keep the
production data mount unchanged during pre-promotion validation.

## Auto quality bands and Radar rollout

Keep `OMNIROUTE_AUTO_BANDS` unset or set to `0` through image build, database
migration, and initial application startup. This preserves upstream routing
until production data and candidate checks pass. Keep
`OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL` unset; it would let an empty
`:free` pool fall back to paid candidates.

### Enable the public Radar catalog

The built-in client targets `https://radar.omniroute.online` by default. In the
verified OmniRoute Settings/DB, enable the `RADAR_ENABLED` feature flag to
expose Radar screens. Then open `/dashboard/radar`, separately opt in to feed
sync, and select **Sync now**. Public/community catalog access is keyless; a
supporter key is not needed for that feed.

Confirm the catalog feed reports `live`, a feed version, and a fetch time, and
that its local cache is populated. Use authenticated `GET /api/radar/status` to
inspect opt-in and all four cache states without exposing a key. Do not require
supporter-only offers or Intel feeds to be populated for public-catalog
activation. The user will enter the supporter Intel key themselves through the
dashboard after deployment. Treat that as a post-deploy user step, not a
prerequisite for public activation. Never put the raw key in this guide, logs,
shell arguments, or screenshots.

### Calibrate and enable band routing

After public catalog sync, create a fresh, consistent, read-only copy of the
production database and run `scripts/ad-hoc/bands-calibrate.ts` from the exact
reviewed source against that copy. Preserve the report outside the repository.
The report is manual and read-only; it does not write operator config. Bands use
the approved Arena/manual score sources. Radar Intel scores remain separate and
are not consumed by band fitness. Use the approved nearest-rank cut points over
sorted distinct numeric rated scores, then write the reviewed ranges to the
operator file referenced by `OMNIROUTE_AUTO_BANDS_CONFIG`. Keep
`calibration.mode` set to `manual` for the initial observation period.

With the flag still off, verify config loading and inspect
`GET /v1/auto-combo/<channel>/candidates` for every Hermes channel planned for
use. Record rated-source coverage, structured-output capability coverage,
candidate counts, and catalog/usage ID matches. Confirm no intended candidate
pool is empty and the free-pool fallback remains unset. Enable
`OMNIROUTE_AUTO_BANDS=1` only after these checks; then send a safe successful
request using a band channel and verify the full requested channel id remains
in `call_logs.combo_name`. Keep manual ranges for one week before changing
`calibration.mode` to `auto`; inspect the first automatic run and persisted
`auto-bands.state.json` before relying on it.

### Demand reserve rollout and rollback

Reserve is opt-in in the band config. For the initial band-routing rollout,
leave `reserve.enabled` false. Disabled means full stop: no quota-source reads,
calculations, refreshes, diagnostics, or account narrowing. Before enabling it,
compare quota provider/model identifiers with the model catalog, inspect the
shared daily-limit metadata shape, measure the 24-hour, 7-day, and 30-day reads
and refresh cost, and compare proposed exclusions with observed exhaustion
using a read-only validation. Review the approved seven-day lookback against
Hermes schedules. Reserve isolation review closed without findings: focused
tests pass 2/2; isolation, reserve, E2E, demand, and capacity suites pass 5
files / 31 tests with two workers. The tests use default adapters, exercise an
enabled refresh and real catalog lookup, guard Radar sync/scheduler access, and
trap same-DB `.prepare` and `exec` writes. They cover an empty feed cache and
static-baseline fallback; cache-overlay/local-merge coverage remains optional,
not a release gate. Then enable reserve explicitly in the operator config and verify
excluded account IDs are removed only from the band candidate allowlist; plain
upstream channels stay unchanged.

For band-routing rollback, set `OMNIROUTE_AUTO_BANDS=0` or unset it, then verify
upstream ordering/filtering resumes. For reserve-only rollback, set
`reserve.enabled` to false; the full-stop behavior suppresses reserve reads and
narrowing. For code rollback, redeploy the previous verified tag. Database
recovery remains a separate operation under the migration runbook; do not
attempt an automatic reverse migration.

## SystemOne decisions route rollout

`/v1/systemone` is off by default. Keep `OMNIROUTE_SYSTEMONE` unset or set to
`0` until a separately approved cutover; only `1` or `true` enables POST
requests. With the flag off, POST returns the catch-all JSON `404` and makes no
upstream call. The endpoint uses the existing client API-key policy, including
the `systemone/<model>` scope check. See the [API contract](../reference/API_REFERENCE.md#systemone-decisions).

Configure credentials in the verified service secret store, never in this
guide or a committed `.env` file. Full variable names and source defaults are
listed in the [environment reference](../reference/ENVIRONMENT.md#28-systemone-decision-route).

| Upstream   | Required setting                                                       | Optional settings and defaults                                                                        |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Laya       | `OMNIROUTE_SYSTEMONE_LAYA_URL` (base URL; `/v1/systemone` is appended) | `OMNIROUTE_SYSTEMONE_LAYA_API_KEY` is optional; `OMNIROUTE_SYSTEMONE_LAYA_MODEL` is unset by default. |
| TypeSafe   | `OMNIROUTE_SYSTEMONE_TYPESAFE_API_KEY`                                 | `OMNIROUTE_SYSTEMONE_TYPESAFE_MODEL=jev-latest` by default.                                           |
| OpenRouter | `OMNIROUTE_SYSTEMONE_OPENROUTER_API_KEY`                               | `OMNIROUTE_SYSTEMONE_OPENROUTER_MODEL=typesafe/jev-1.13` by default.                                  |

`OMNIROUTE_SYSTEMONE_ORDER` defaults to `laya,typesafe,openrouter`; only
configured upstreams participate. `OMNIROUTE_SYSTEMONE_TIMEOUT_MS` defaults to
`5000` and `OMNIROUTE_SYSTEMONE_COOLDOWN_MS` to `30000`. Production Laya-only
cutover uses order `laya` and timeout `180000` to allow lazy CPU checkpoint
loading. TypeSafe/OpenRouter failover is not configured by this cutover.

Select the upstream checkpoint with `model: "laya/english"`,
`"laya/multilingual"`, or `"laya/laya-browser-v10s"`. OmniRoute strips the
provider prefix and forwards the checkpoint name. Omit `model` for Laya's
automatic routing when the deployment checkpoint override remains unset.
Browser state must be a serialized page-state JSON string as required by its
native adapter. Caller bearer token is the OmniRoute key; the upstream Laya
key remains in the protected server env file.

### SystemOne cutover gates and rollback

Before enabling the flag, verify in the production-like test instance that:

- With the flag unset or `0`, POST returns the catch-all JSON `404` and makes
  no upstream call.
- A successful response, pinned request, chain fallback, timeout, oversized
  request, and all-upstreams-failed case match the API contract.
- `call_logs` has one metadata-only row per attempt. During rollout, inspect
  rows for `path = /v1/systemone` and `provider = laya`, and compare failures
  with `X-OmniRoute-SystemOne-Attempts` to confirm expected fallback/cooldown.
- OpenRouter's live request and response shape has been verified before its key
  is configured in production.

Local SystemOne implementation validation is complete: 46 schema, dispatch,
and route tests pass; OpenAPI coverage passes 8/8 and the route checker reports
276 baseline entries with 0 new findings. On 2026-10-04 the user authorized
Laya-only production connection. Initial authenticated HTTP dispatch returned
404 despite enabled env settings. The overlay bundle was loadable, but the
root app-path-routes manifest omitted SystemOne; static route descriptors were
also stale. Authorized temporary container-manifest repair restored real HTTP
dispatch. English, Russian and Ukrainian choice calls returned 200 and selected
`technical`; a frozen browser-v10s request returned 200/choice2 with native
1024/768 context and no truncation. Browser smoke verifies profile connectivity,
not live action execution or general accuracy. Private keyless requests return
401, public `/v1/systemone` returns403, Redis DNS/TCP pass, and the application
remains healthy. The temporary patch disappears on container recreation;
`fix-overlay-http-route-registration` tracks permanent source-image replacement.

Laya failure and oversized-state fallback, OpenRouter live-shape validation,
restricted-key acceptance, and the 50-request direct-versus-OmniRoute latency
comparison remain pending in the original SystemOne package. Individual smoke
latencies are not that benchmark. Secrets live in the protected deployment
`.env`; pre-cutover backup is
`/opt/apps/omniroute/.env.before-laya-20261004T085725Z`. Temporary manifest
backups are under
`/opt/apps/omniroute-deploy-diagnostics/laya-systemone-20261004/`.

Rollback the route switch by unsetting `OMNIROUTE_SYSTEMONE` or setting it to
`0` through the verified service configuration, then restart the application
as required by that deployment mechanism. Verify that POST again returns the
catch-all JSON `404` with no upstream call. Keep database recovery under the
one-time migration runbook.

## Build and publish the main image

Keep routine test/check workflows disabled. After upstream synchronization,
leave them disabled and keep only `.github/workflows/omni-overlay-image.yml`
active. The API route typecheck, quarantine, and release acceptance workflow
files are manual-dispatch-only. The image workflow is the only automatic
workflow and only runs on a push to the canonical `Etcetera-Agency/OmniRoute`
`main` branch; a manual image run must select exact `refs/heads/main`. Feature
pushes, pull requests, and schedules run no automatic tests or checks.

The image workflow uses the native `ubuntu-24.04-arm` runner and the pinned
official OmniRoute base digest. It compiles backend routes once, loads the
browser-capable `runtime-web` candidate locally, and checks ARM64, OCI labels,
native SQLite, health, direct UI/API behavior, a non-root headed Chromium
launch, and full official-UI parity before logging in to GHCR. The disposable
candidate uses `REQUIRE_API_KEY=true`; the preserved client-API proxy rejects
keyless direct UI `GET /api/v1/models` with exactly HTTP 401 `AUTH_002`, before
the catalog handler runs. The workflow and Docker builder do not run unit or
static test gates; invoke
task-specific checks manually when requested.

The browser stage explicitly declares `CMD ["node", "dev/run-standalone.mjs"]`
after its Xvfb entrypoint: Docker clears an inherited command when an entrypoint
is redefined. Before starting any candidate container, verification checks the
actual image's `User`, `Entrypoint`, and `Cmd`; it does not rely on assumed
inheritance.

Start the disposable candidate with `docker run --init`, matching the server's
Compose `init: true`. Without init, the Xvfb wrapper can wait for its readiness
signal before it reaches the Node launcher. Keep `init: true` in the server's
effective Compose configuration when changing the image. The headed browser
check runs through `docker exec` with its own Xvfb display.

After those checks pass, Actions publishes the full source SHA tag. It moves
`:main` only if the source commit is still the current main commit when
publishing; a rerun for an older main commit leaves the alias unchanged. The
workflow summary records the actual manifest digest, source commit, pinned base,
and run URL. A SHA tag is a convenient reference; deploy by digest because tags
can move.

The first successful GHCR publication passed in main Actions run
[`37142905181`](https://github.com/Etcetera-Agency/OmniRoute/actions/runs/37142905181)
for source `9e6e053efe56fc13ea6d9b106feb18503a9a70a7`. Both the full-SHA and
`:main` tags resolve to manifest digest
`sha256:671177c97f894c2bebb2da6cc9dadc0b89fc65bc031eeb044862276eb2322c66`;
the pinned official base digest is
`sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
Native acceptance passed for ARM64, SQLite 3.53.4, configured healthcheck,
direct UI root HTTP 200, unauthenticated direct UI API HTTP 401 `AUTH_002`,
non-root headed Chromium under Xvfb opening/closing `about:blank`, and complete
official-UI parity. Registry digest, tags, and workflow summary agree.

The GHCR package is public. The owner temporarily allowed organization public
package creation, changed only this package to public, then restored the
organization setting to Public off, Private on, and Internal off. Credentialless
manifest requests returned HTTP 200 with matching digest; the server owner
also completed a full anonymous Docker image pull and verified ARM64 and OCI
source/revision/base labels. Evidence is recorded in
`/tmp/hermes-omniroute-deploy-acceptance-9e6e053e-20261003.md`. The workflow
never changes package visibility. Public images can
be pulled without a supporter key or other application credential.

## Initial server cutover and manual recovery

Completed operator run on 2026-10-03: the server owner completed the anonymous
Docker image pull and verified ARM64 plus OCI source, revision, and base labels
against the published run. Preflight of the combined four-file Compose
configuration retained the three existing Compose files plus the digest
override, `init: true`, data bind, API port `20129`, and all four networks; the
rollback configuration still resolves to the previous
browser-capable image. An app-only `docker compose up -d --no-build --no-deps
--pull never` cutover recreated and started the service. Health, SQLite 3.53.4,
UI/API/dashboard, migration table 196 with 193 numeric rows (maximum 196) and
three preserved legacy rows, and UID 1000 headed-browser acceptance passed.
No migration ran. Redis container identity/health, old browser image, and fresh
backup remain preserved. Durable sanitized evidence is recorded in
`/tmp/hermes-omniroute-deploy-acceptance-9e6e053e-20261003.md` and
`/opt/apps/omniroute-deploy-diagnostics/main-image-9e6e053e-precutover-20261003T182221Z/deploy-acceptance-cache.txt`.
After confirming no active build, only the dedicated builder and unused
BuildKit cache were removed. Cache fell from 72.35 GB reclaimable to 0 B; the
measured root-filesystem space gain was 73,019,129,856 bytes (73.02 GB /
68.02 GiB). App and Redis remained healthy; rollback image and backup remain.

Use the server's existing Docker Compose configuration. Before
changing the image, record the currently configured image digest, service
health, and the database migration state using the existing migration runbook.
Confirm that the new main workflow run passed image acceptance and that its
summary says the `:main` alias was updated. Compare its commit, base digest, and
published digest with the run you intend to deploy.

The 2026-10-03 server readiness snapshot has three active Compose files: the
base file, the original candidate override, and a browser recovery override.
The current browser-capable image is
`omniroute:55f40468-official-overlay-web-browser-20261003`, with image ID
`sha256:4e4d6d722d90777ebc0223d49db205f925f99c05b90447dd34551a239191eb3c`.
The browser recovery override selects only the image; Chromium, Playwright,
and the Xvfb entrypoint are baked into it. Preserve all three configuration
files and add a new digest-only override last. Verify the new image's browser
acceptance before replacing this working image.

Resolve and pin the published digest, then pull and start without building
source. Run remote commands through an SSH heredoc:

```bash
ssh etc2nd-shlink <<'REMOTE'
set -eu
sudo -n docker buildx imagetools inspect ghcr.io/etcetera-agency/omniroute:main
image='ghcr.io/etcetera-agency/omniroute@sha256:PASTE_VERIFIED_DIGEST'
cutover_dir="/opt/apps/omniroute-deploy-diagnostics/main-image-$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n docker pull "$image"
test "$(sudo -n docker image inspect --format '{{.Architecture}}' "$image")" = arm64
sudo -n install -d "$cutover_dir"
printf 'services:\n  omniroute:\n    image: %s\n' "$image" | sudo -n tee "$cutover_dir/image-compose.yml" >/dev/null
sudo -n docker compose --project-directory /opt/apps/omniroute -p omniroute \
  -f /opt/apps/omniroute/docker-compose.yml \
  -f /opt/apps/omniroute-deploy-diagnostics/prod-cutover-55f40468-20261003T095314Z/candidate-compose.yml \
  -f /opt/apps/omniroute/recovery/free-web-guests-20261003/browser-compose.yml \
  -f "$cutover_dir/image-compose.yml" up -d --no-build --no-deps --pull never omniroute
REMOTE
```

Use the `sha256:` digest recorded by `imagetools inspect` and compare it with
the successful main workflow summary before continuing. The server's older
base Compose file still has a `build` definition, so `--no-build` is required.
The final override changes only the image; preserve environment, data mounts,
ports, networks, labels, and Redis.

Check the service health, the dashboard on the configured dashboard port, and
the direct UI listener's `/api/v1/models` dispatch according to the current
authentication configuration. A disposable native SQLite check can run inside
the container without touching the application database:

```bash
ssh etc2nd-shlink <<'REMOTE'
set -eu
sudo -n docker inspect --format '{{.State.Health.Status}}' omniroute
sudo -n docker exec omniroute node healthcheck.mjs
sudo -n docker exec omniroute node --input-type=module -e 'for (const [path, allowed] of [["/", [200]], ["/api/v1/models", [200, 401]]]) { const r = await fetch(`http://127.0.0.1:20128${path}`, {signal: AbortSignal.timeout(10000)}); console.log(path, r.status); if (!allowed.includes(r.status)) process.exit(1); }'
sudo -n docker exec omniroute node -e 'const d=require("better-sqlite3")(":memory:"); console.log(d.prepare("select sqlite_version() as version").get()); d.close()'
REMOTE
```

For rollback, run the same Compose command with the three original files,
omitting the new digest override; use `--no-build --pull never` and verify the
previous browser image and health. Preserve this image until acceptance is
complete. This manual image-only rollback does not reverse database changes;
use the protected database snapshot when migration recovery is required.

## Automatic deployment after main publication

Successful main-image publication automatically deploys the existing Compose
service on `etc2nd-shlink`. The first complete workflow and actual host
acceptance passed on 2026-10-04:
[PR18](https://github.com/Etcetera-Agency/OmniRoute/pull/18) and
[main run37171754347](https://github.com/Etcetera-Agency/OmniRoute/actions/runs/37171754347).
Image builds remain confined to main; feature pushes, pull requests, and
schedules run no automatic tests or image builds.

The accepted change is archived in
[`2026-10-04-add-main-image-ssh-cd`](../../openspec/changes/archive/2026-10-04-add-main-image-ssh-cd/design.md).
Its current contract lives in
[`main-image-ssh-cd`](../../openspec/specs/main-image-ssh-cd/spec.md).
Later main merges use the same image/CD workflow; verify the matching server
SUCCEEDED journal and record the current source/digest in the server playbook.

The deployment job uses the GitHub `production` environment, restricted to the
main branch. Only that job receives `OMNI_DEPLOY_SSH_PRIVATE_KEY`; the public
`OMNI_DEPLOY_SSH_KNOWN_HOSTS` variable pins the server's ED25519 identity.
The dedicated SSH account accepts only `deploy-main`, with one validated
stdin record containing the published digest, source SHA, run ID, and run
attempt. It cannot choose image repositories, commands, Compose files, or data
paths. Keep the human `opc` key out of GitHub Actions.

Install and recover the restricted host boundary with
[`scripts/deploy/SERVER-INSTALL.md`](../../scripts/deploy/SERVER-INSTALL.md).
The authoritative Compose copies live under `/etc/omniroute-deploy/compose/`;
the fixed configuration uses the actual `omniroute-redis` service. Preserve
root ownership and protected modes for configuration, journals, and backups.

The publisher and deployment have separate concurrency groups. A newer push
may replace an obsolete build, but it cannot cancel a running deployment.
The runner checks current main before SSH; the server checks it again before
stopping the app. An obsolete source is skipped without changing the service
or database. The server starts a durable systemd task, so runner cancellation
or SSH loss does not interrupt migration or recovery. Repeating the same
run/attempt attaches to its existing result; a GitHub rerun has a new attempt.

The server pulls the accepted immutable digest without registry credentials,
checks architecture and source identity, and takes the deployment lock. It
stops only OmniRoute, then creates and validates a protected SQLite backup
including WAL state. Candidate startup applies the application's migrations.
Acceptance checks service health, UI/API behavior, database integrity and
migration coverage, and the unchanged Redis service. Compose uses
`--no-build --no-deps --pull never`; the server does not compile source.

Standalone WAL-mode backup checks allow the native read-only SQL connection
to create temporary sidecars in the snapshot directory under the DB file's
numeric owner/group. Existing companions are rejected; only newly created
regular matching-owner companions are cleaned up. Main-file hash and
ownership/mode must remain unchanged. Live checks use the actual read-only
data directory and preserve shared WAL/SHM files, running as the actual DB
file's numeric owner/group. With Linux capabilities dropped, UID0 does not
bypass app-owned file permissions; no owner fallback is used.

Private UI/API acceptance runs through Node inside the app container against
its loopback listener on 20128. The published host listener on 20129 is the
private gateway and does not serve those probe paths. Public dashboard
acceptance runs from the host through HTTPS; no new port binding is needed.

If deployment fails after the candidate may have changed the database, recovery
stops the app, preserves the failed database, restores the snapshot while
handling WAL/SHM files, restores the previous image, and checks its health.
If backup fails before candidate startup, recovery restarts the previous
service without restoring the untouched database. Original backups and
rollback images remain protected. Automatic database restoration is the
user-selected policy; writes accepted after candidate startup can be discarded
by recovery. OmniRoute is unavailable while stopped for backup and restart.
If candidate diagnostics cannot be preserved, database restoration fails, or
the previous service cannot pass acceptance, recovery keeps the app stopped
and retains the protected backup and candidate files. An unresolved post-stop
worker journal remains retryable; a terminal rollback failure requires repair
using its protected artifacts. Host reboot recovery remains separate work.

Before enabling live CD, rehearse actual migration and failed-deployment
recovery against an isolated database copy. Fixture containers stay on internal
networks without published ports; a temporary root-controlled host-loopback
proxy relays the fixture gateway's actual HTTP 404 to the public probe. Remove
the proxy after proof and retain protected recovery artifacts. Task-specific checks run manually;
they must not become regular push, PR, main, or scheduled test gates. Snapshot
retention is separate maintenance work recorded in `openspec/TODO.md`.

Host acceptance completed on 2026-10-04. Isolated transaction
`20261004030000-1` applied real migration196, rejected the actual public404,
retained the failed candidate, and restored a DB whose SHA-256 matched the
protected backup before prior startup. Prior app/native checks passed and
fixture Redis stayed unchanged. Production smoke `20261004040000-1` survived
SSH loss and completed SUCCEEDED; restricted exact-tuple reattachment returned
canonical success without changing the journal, unit or production containers.
Native DB, private UI/API and public dashboard acceptance passed. The fresh
production backup SHA-256 is
`d667b6941e6a78549f2e894db99ed635bd98a6bde1cd0606220f8649ced921ae`.
Actual automatic server transaction `37171754347-1` then completed
`SUCCEEDED/complete` for main source
`4407a3c1929675b023d55abcf5d0909aa3a6bd23`, image
`ghcr.io/etcetera-agency/omniroute@sha256:d653f0812ce6f5201713f862d4dbcefb80ee5d151eb93f6909b82cb757525a2b`.
The protected backup is
`/opt/apps/omniroute-deploy-diagnostics/transactions/37171754347-1/pre-deploy.sqlite`
(root:root0600), SHA-256
`20474dcfd9ab5812ecb1e73c2609f51d71bc027035b528bdabbff44dec1bc32b`.
Its manifest is the corresponding protected status journal's backup path/hash.
The actual image revision and accepted root-owned Compose override match this
source/digest; the app is healthy and original Redis identity is preserved.
The temporary fixture proxy, containers and internal network are removed;
protected fixture recovery evidence remains.

The authorized cache cleanup is complete. The measured 72.35 GB reclaimable
default cache fell to 0 B after removing the unused
`omniroute-deploy-db18a17` builder and running `docker builder prune --all
--force` on the default builder. Used root-filesystem bytes fell from
`130258251776` to `57239121920` (73,019,129,856 bytes / 73.02 GB / 68.02 GiB).
The 16.31 GB dedicated-builder and 72.35 GB default-cache figures overlap, so
they are not additive. No image, system, or volume prune ran. The application,
Redis, rollback image, databases, volumes, and fresh backup were preserved.

Enable band routing only after its production gates pass by setting
`OMNIROUTE_AUTO_BANDS=1`. Leaving it unset or setting it to `0` disables band
filters, band-specific ordering, and reserve/account narrowing.
