# Design: Reconcile the fork onto official OmniRoute v3.8.52

## Selected source and runtime

The canonical GitHub release page is
`https://github.com/cheaper-inference/OmniRoute/releases/tag/v3.8.52`. Its
`v3.8.52` tag resolves to the verified commit
`ad6f33f66bda34eba98645d3bfdabbde294bc843`; the tag object is
`cac024bcf3999e46092a763a18eefced77e36acf`. The release's official backend
image is `ghcr.io/diegosouzapw/omniroute:3.8.52`, whose OCI index is
`sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c` and
whose `linux/arm64` child is
`sha256:fb7f91836fd95f382a5a04af740d859e2e9731804b5c0ba43f5d2e7f9ad64794`.
The overlay workflow and Dockerfile both pin the index digest. The workflow's
native ARM64 run will consume the ARM64 child through platform selection.

Use the existing release procedure: rebase the clean isolated feature branch
with `git rebase --onto ad6f33f66bda34eba98645d3bfdabbde294bc843
23a11484862b3bb589a55e85b00e4ac53ffeb234`. The starting branch is exactly
`7bb10048702966cccaa0eebe62bb83bfad040265`, which descends from the old base.
Resolve each conflict against both complete source trees: accept upstream's
final implementation and tests by default, retain unique fork-owned features,
and merge shared files surgically. A resolution is rejected if it removes a
fork-owned capability or changes its stated invariants to make the rebase pass.

## Migration identity map

The numeric migration ledger is an applied-version key, so collisions must be
resolved before code is packaged. The fork's deployed migrations and the new
source map are:

| Source | Final prefix | File stem |
| --- | ---: | --- |
| Fork 197 | 197 | `model_benchmark_search` |
| Fork 198 | 198 | `model_benchmark_catalog_backfill` |
| Fork 199 | 199 | `model_benchmark_search_retry_after` |
| Official 197 | 200 | `proxy_subscription_core_config` |
| Official 198 | 201 | `proxy_subscription_core_binary` |
| Official 199 | 202 | `proxy_operator_egress` |
| Official 200 | 203 | `provider_health_matrix_covering_index` |
| Official 201 | 204 | `drop_unused_turn_node_indexes` |
| Official 202 | 205 | `model_capabilities_reasoning_efforts` |
| Official 203 | 206 | `memory_fts_content_rowid` |
| Official 204 | 207 | `llmlingua_service` |
| Official 205 | 208 | `api_key_codex_service_mode` |
| Official 206 | 209 | `codex_wakeup_tasks` |
| Official 207 | 210 | `remove_opencode_free_provider` |
| Official 208 | 211 | `proxy_subscription_selector_last_switch_by_selector` |
| Official 209 | 212 | `call_logs_artifact_relpath_index` |
| Official 210 | 213 | `call_logs_detail_pending` |
| Official 211 | 214 | `recreate_turn_nodes_content_hash_index` |
| Official 212 | 215 | `usage_history_provider_reported_cost` |
| Pending fork 200 | 216 | `model_benchmark_evidence_current_set` |

The existing production rows at fork IDs 197–199 keep their names, SQL, and
meaning. The pending fork migration has not run in production, so its file and
all code references move to 216 without renumbering an applied ledger row. Do
not add compatibility views, duplicate source tables, or dual writes.

The upstream effects remain in upstream order. In particular, final 204 drops
the two unused `conversation_turn_nodes` indexes and final 214 recreates the
content-hash index after its upstream query changes; final 206 rebuilds the
FTS5 index on `memories.memory_id`, backfills missing IDs, and restores the
insert/update/delete triggers; final 210 moves credentialed `opencode`/`oc`
connections to `opencode-zen`, deletes only rows that remain keyless, and
removes the retired provider configuration. Keep the SQL content unchanged
when changing only its numeric filename prefix.

The migration runner and all consumers must agree on the final map. The
overlay Dockerfile removes `/app/migrations` from the official base and copies
the source migration directory, so the built image must expose exactly the
reviewed source set. Tests must fail if any original official 197–212 filename
survives or if any expected mapped file is missing.

## Conflict-resolution pseudocode

```text
assert branch == feat/upstream-v3852-final-20261027
assert HEAD == 7bb10048702966cccaa0eebe62bb83bfad040265
assert tree is clean
rebase --onto official_v3_8_52 old_upstream_base branch

for each conflicted path:
  inspect old fork version, new official version, and upstream tests
  if path is upstream-only:
    keep final upstream version
  else if path is fork-only:
    preserve fork implementation and tests
  else:
    merge behavior and both test contracts in the same file
  reject a resolution that weakens free-only/zero-cost routing,
    benchmark formula/profile/tie behavior, full-catalog publication,
    or native capability handling

rename official migrations 197..212 to 200..215 without editing SQL
rename pending fork migration 200 to 216
update every runner, guard, test, verifier fixture, and spec reference
assert source inventory == expected mapped migrations
assert overlay inventory == the same source inventory
run focused migration, benchmark, Auto-band, capability, and overlay checks
```

## Regression contract

The source review must compare the complete resulting tree to the final
upstream tag and inspect every fork-only diff. Run upstream migration tests for
the two turn-node index transitions, FTS5 rebuild, and OpenCode credential
cleanup after adjusting expected migration prefixes. Test that the ledger
preserves IDs 197–199 and applies upstream 200–215 before pending fork 216;
verify no duplicate or unreviewed migration files reach the overlay. Run the
existing current-snapshot benchmark, formula/profile, Auto-band free-only,
capability, and overlay tests selected from the touched conflict surfaces.
Record baseline failures separately and do not claim new or unrelated test
errors as passing.

No image build is part of this change. After a reviewed merge, TL313 will run
the complete ordered migration rehearsal against its isolated production DB
clone, including integrity, foreign-key, migration-specific FTS/credential,
benchmark formula, and snapshot-restore rollback checks. Only after that gate
and the parent grant may the disabled final ARM64 image workflow be used.
