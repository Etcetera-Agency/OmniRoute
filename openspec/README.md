# Auto quality bands for OmniRoute

Status: **Approved for implementation**. These change packages are active under
`openspec/changes/`.

Validated against upstream `release/v3.8.52` at
`23a11484862b3bb589a55e85b00e4ac53ffeb234` (2026-10-02). The implementation
branch is `feat/auto-quality-bands`.

## Change sequence

| Order | Change                                                                  | Scope                                                                          | Depends on |
| ----: | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
|     1 | [`add-auto-band-seam`](changes/add-auto-band-seam/)                     | Channel grammar, upstream parser and pool seams, degraded fallback, sync tests | —          |
|     2 | [`add-auto-quality-band-filter`](changes/add-auto-quality-band-filter/) | Quality bands, capabilities, calibration                                       | 1          |
|     3 | [`add-auto-band-demand-reserve`](changes/add-auto-band-demand-reserve/) | Demand/capacity reserve and account-level narrowing                            | 1, 2       |

All packages add requirements to the `auto-quality-bands` capability.

## Approved behavior

- Band IDs use `auto/<task>_<band>[_<cap>...][:<tier>]`; tasks are `general`
  or `coding`, bands are `low`, `mid`, or `high`, and capabilities are
  `tools`, `so`, `reasoning`, and `vision`.
- With `OMNIROUTE_AUTO_BANDS` enabled, an omitted tier on a band channel defaults
  to `thrifty`. With the flag off, the adapter leaves the tier omitted for
  upstream default handling. Explicit tiers retain upstream behavior.
- Enabled band `thrifty` channels order eligible candidates
  `free → keyless → subscription → cheap → premium`. Plain upstream
  `auto:thrifty` ordering remains unchanged. Ordering changes priority only;
  existing eligibility, quality, quota, budget, cost, and availability filters
  remain in effect.
- Unrated models are admitted only to `low`; no synthetic score is assigned.
  Calibration uses rated scores only. The former `agt` role maps to
  `general + tools`.
- Reserve removes reserved connection IDs before band ordering and dispatch;
  a candidate remains if any allowed ID remains, and is removed when none do.
- Turning `OMNIROUTE_AUTO_BANDS` off bypasses band quality/capability filters,
  band-specific ordering, and reserve/account narrowing. It leaves candidate
  `allowedConnectionIds` unchanged and delegates non-band channels unchanged.
- Explicit `:free` preserves upstream provider/model classification, including
  eligible keyless OpenCode models. It does not guarantee zero spend per
  connection.

Shared upstream integration points: `suffixComposition.ts` and
`virtualFactory.ts`. No runtime changes are included in this approval commit.

## Follow-up checks

Required production and integration checks, deploy-playbook work, and deferred
Hermes profile migration are tracked in [`TODO.md`](TODO.md). Fork rebase,
deploy-tag, and production-target procedures are documented in the
[Fork Release and Deployment guide](../docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md).
