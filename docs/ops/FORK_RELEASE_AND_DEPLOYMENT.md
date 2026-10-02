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

Do not create or promote a deploy tag until every gate passes and the production
database migration conflict below has an approved resolution.

- Rebased branch matches the selected upstream tag and has no unintended fork
  delta.
- Band grammar, identity, seam, and filter tests pass, along with the unmodified
  upstream `autoCombo` unit tests. Typecheck and lint pass.
- Any high-priority code-review findings are fixed and reviewed. The prior
  final-selection finding about free-before-premium band order is fixed and
  reviewed; all remaining promotion gates below still apply.
- A full build and start smoke completes against an isolated, consistent copy
  of the production SQLite database. Record startup and migration output; never
  use the live mounted database for this check.
- With `OMNIROUTE_AUTO_BANDS` unset and with it set to `0`, verify the full
  upstream-routing fallback: band quality/capability filters, band ordering,
  and reserve/account narrowing are bypassed.
- Complete the live combo identity check: request
  `auto/general_mid:free`, confirm routing as `auto/chat:free`, and confirm
  `call_logs.combo_name` retains `auto/general_mid:free`.

### Current validation record

As of 2026-10-03, typecheck has 0 errors, lint passes with 8 warnings, and 284
tests pass. The high-priority review fix is pending. Full build/start against the
isolated production-database copy and the live `call_logs.combo_name` check are
also pending. These results do not authorize a deploy tag or production
promotion.

## Production database migration gate

The overlapping migration history has a copy-only rekey procedure that passed
an isolated database rehearsal; see
[the FMO migration ledger rehearsal](AUTO_BANDS_MIGRATION_REHEARSAL.md). The
rehearsal does not authorize a production ledger repair, which requires a
separate approved maintenance change and a successful Node 24 build/start
smoke. The fork uses migration IDs 164–166 for `fmo_pools`,
`fmo_pool_decisions`, and `fmo_pool_live_seam`; upstream uses those IDs for
`retire_microsoft_designer_web`, `retire_felo_web`, and
`retire_gpl_derived_providers`. Do not deploy until the production repair has
separate approval and all pre-promotion gates pass.

## Verify the production target

The current production SSH target alias is `etc2nd-shlink`. Its host data
directory `/opt/apps/omniroute/data` is mounted at `/app/data`; SQLite is stored
at `/app/data/storage.sqlite` inside the application environment.

The active source checkout path is **unknown**. The previously used
`/opt/apps/omniroute/source` path is missing; only timestamped backups were
found. Before deployment, verify the live service/container definition, active
checkout or image, running commit/tag, and the data mount on the host. Record the
verified target in the deployment record. Do not assume the missing path or use
a timestamped backup as the active source.

Take a durable database snapshot before any approved deployment. Perform build,
startup, and migration checks against a separate consistent copy. Keep the
production data mount unchanged during pre-promotion validation.

## Deploy tag and promotion

Name each immutable fork deploy tag:

```text
<upstream-tag>-bands.<n>
```

Use the next unused positive integer for `<n>` under the same upstream tag. Tag
only the exact commit that passed all pre-promotion gates, and pin production to
that tag. Do not move or overwrite a published deploy tag.

Creating or pushing a deploy tag, pushing a rebased feature branch, and
promoting a tag to production each require explicit user approval. After
approval, push only the named branch and exact tag; do not push `main`, all
branches, or wildcard tags. Do not merge the fork branch into `main` without
explicit approval.

After approval and after every gate passes, create an annotated tag on the exact
verified commit. Set `deploy_tag` to the selected upstream tag followed by
`-bands.` and the next unused number; set `verified_commit` to the full commit
SHA:

```bash
deploy_tag='vX.Y.Z-bands.1'
verified_commit='FULL_VERIFIED_COMMIT_SHA'
git tag --annotate "$deploy_tag" "$verified_commit" --message "OmniRoute fork deploy $deploy_tag"
git show --no-patch --format='%H %D' "$deploy_tag"
```

After approval, publish the rewritten branch with lease protection and publish
only that deploy tag:

```bash
git push --force-with-lease origin feat/auto-quality-bands
git push origin "$deploy_tag"
```

Never use `git push --all`, `git push --tags`, or `--force`.

Enable band routing only on an approved deployment by setting
`OMNIROUTE_AUTO_BANDS=1`. Leaving it unset or setting it to `0` disables the
band filters, band-specific ordering, and reserve/account narrowing. For code
rollback, redeploy the previous verified deploy tag. Handle database recovery
only under the separately approved migration plan; this guide assumes no
automatic migration reversal.
