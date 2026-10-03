---
title: "OmniRoute Fork Release and Deployment"
lastUpdated: 2026-10-03
---

# OmniRoute Fork Release and Deployment

This guide is the release and server-deployment procedure for the OmniRoute
fork carrying auto quality bands. It governs upstream rebases, fork deploy tags,
pre-promotion checks, and production targeting. Hosting-specific commands stay
in their provider guides; the active production checkout and deploy mechanism
must be verified before use.

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
upstream contracts, then inspect the fork-only diff and rerun every pre-promotion
gate below. Do not merge upstream `main` as a substitute for this tag-based
rebase. Any push of the rewritten branch requires explicit user approval; if
approved, push only `feat/auto-quality-bands` with lease protection. A merge to
`main` also requires explicit approval.

## Pre-promotion gates

Do not create or promote a deploy tag until every applicable gate passes and
the exact release commit is verified. The production ledger conflict has an
approved one-time repair procedure and isolated-copy rehearsal; production
execution still waits for the supported-runtime build/start gate.

- Rebased branch matches the selected upstream tag and has no unintended fork
  delta.
- Band grammar, identity, seam, filter, calibration, reserve, and unmodified
  upstream `autoCombo` tests pass. Typecheck, scoped lint, and formatting pass.
- Independent review findings are fixed and closed. The final-selection and
  quota-cutoff routing findings, five calibration findings, reserve review,
  and SystemOne review are closed; this does not replace live verification.
- The exact release commit builds and starts with the stock Node 26 image on a
  fresh, consistent, isolated production-database copy. Record startup and
  migration output; never use the live mounted database for this check.
- With `OMNIROUTE_AUTO_BANDS` unset and with it set to `0`, verify the full
  upstream-routing fallback: band quality/capability filters, band ordering,
  and reserve/account narrowing are bypassed.
- Complete the live combo identity check: request
  `auto/general_mid:free`, confirm routing as `auto/chat:free`, and confirm
  `call_logs.combo_name` retains `auto/general_mid:free`.

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
image; no cutover or production migration ran, and production remains at
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
clear. No image or start result was produced. Preserve the 2-GiB host and
14-GiB disk hard floors. Production remains at
`f2bddef27ed0807dd5a5e2712bc26536edda8138`, and staged source remains
`db18a17c374506941d10fbc58132eb108d1ea5db`.
The successful-chat
`call_logs.combo_name` check, public Radar sync/cache check, real-catalog
calibration, and reserve live-read validation are also pending. The active
production source/container is at
`f2bddef27ed0807dd5a5e2712bc26536edda8138`. The separate staged deployment
target is `db18a17c374506941d10fbc58132eb108d1ea5db`; it is not live. Verify
both full SHAs against the host before cutover. No live deployment or
production ledger repair has yet been recorded here.

## Production database migration gate

The overlapping migration history has a one-time rekey procedure that passed
an isolated database rehearsal; see
[the FMO migration ledger rehearsal](AUTO_BANDS_MIGRATION_REHEARSAL.md). The
user has authorized the production migration for this rollout. Execute it only
after the exact release commit passes the stock Node 26 build/start smoke on an
isolated copy and a fresh, consistent backup is verified. The fork uses
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
metadata were verified present and clean. The active production
source/container is `f2bddef27ed0807dd5a5e2712bc26536edda8138`; the separate
staged deployment target is `db18a17c374506941d10fbc58132eb108d1ea5db`. These
SHAs are distinct: the staged target is not live. Before cutover, verify the
live service/container definition, staged exact commit and image, runtime
version, and data mount; record them in the deployment record. Keep the last
known rollback image and database backup intact.

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
`5000` and `OMNIROUTE_SYSTEMONE_COOLDOWN_MS` to `30000`. Keep the default order
until live failover and latency checks are complete.

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
276 baseline entries with 0 new findings. No live upstream calls are recorded.
Russian/Ukrainian answer checks, Laya failure and oversized-state fallback,
OpenRouter live-shape validation, `laya` error-row monitoring, and the
50-request direct-versus-OmniRoute latency comparison remain pending. Record
both latency medians before enabling the route. The exact release commit still
needs the supported Node 26 build/start against the isolated copy described
above.

Rollback the route switch by unsetting `OMNIROUTE_SYSTEMONE` or setting it to
`0` through the verified service configuration, then restart the application
as required by that deployment mechanism. Verify that POST again returns the
catch-all JSON `404` with no upstream call. Keep database recovery under the
one-time migration runbook.

## Deploy tag and promotion

Name each immutable fork deploy tag:

```text
<upstream-tag>-bands.<n>
```

Use the next unused positive integer for `<n>` under the same upstream tag. Tag
only the exact commit that passed all pre-promotion gates, and pin production to
that tag. Do not move or overwrite a published deploy tag.

Use the user's current authorization for this deployment and activation. Push
only the reviewed feature branch and exact deploy tag; never push `main`, all
branches, or wildcard tags. A future rebase, history rewrite, new release scope,
or merge to `main` requires its own explicit approval.

After every gate passes within the user's current deployment authorization,
create an annotated tag on the exact verified commit. Set `deploy_tag` to the
selected upstream tag followed by `-bands.` and the next unused number; set
`verified_commit` to the full commit SHA:

```bash
deploy_tag='vX.Y.Z-bands.1'
verified_commit='FULL_VERIFIED_COMMIT_SHA'
git tag --annotate "$deploy_tag" "$verified_commit" --message "OmniRoute fork deploy $deploy_tag"
git show --no-patch --format='%H %D' "$deploy_tag"
```

Publish only the reviewed feature branch if needed, then publish only that
deploy tag within the current authorization. Use lease protection only when a
separately approved history rewrite is part of the operation:

```bash
git push --force-with-lease origin feat/auto-quality-bands
git push origin "$deploy_tag"
```

Never use `git push --all`, `git push --tags`, or `--force`.

Enable band routing only after its production gates pass by setting
`OMNIROUTE_AUTO_BANDS=1`. Leaving it unset or setting it to `0` disables band
filters, band-specific ordering, and reserve/account narrowing. For code
rollback, redeploy the previous verified deploy tag. Handle database recovery
under the one-time migration runbook; this guide assumes no automatic migration
reversal.
