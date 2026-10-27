# Change: Upgrade the fork to the final OmniRoute v3.8.52 release

## Why

The fork was based on the earlier `release/v3.8.52` commit
`23a11484862b3bb589a55e85b00e4ac53ffeb234`. The final official GitHub release
tag `v3.8.52` resolves to `ad6f33f66bda34eba98645d3bfdabbde294bc843`. Updating
only `package.json` would leave the backend source and its official image on an
earlier release candidate. The final tag includes upstream behavior and schema
changes that must be integrated before producing the next overlay image.

## What Changes

- Rebase the approved fork main snapshot, including benchmark fix
  `7bb10048702966cccaa0eebe62bb83bfad040265`, onto the exact official final
  tag using the documented tag-reconciliation procedure.
- Preserve fork-owned benchmark search/current-catalog publication,
  `benchmark_fitness` profiles and formula, strict zero-cost free-only bands,
  Auto routing, and capability behavior while retaining the final upstream
  tree and its release changes.
- Pin both overlay base references to official v3.8.52 manifest
  `sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c`;
  record the ARM64 child digest
  `sha256:fb7f91836fd95f382a5a04af740d859e2e9731804b5c0ba43f5d2e7f9ad64794`
  as verification evidence.
- Preserve deployed fork migration IDs 197–199. Renumber upstream migrations
  197–212, in original order, to 200–215. Renumber the merged but not yet
  deployed fork migration 200 to 216. Update every migration runner rule,
  filename, fixture, test, and documentation reference affected by this map.
- Ensure the overlay migration copy contains only the reviewed mapped set and
  never leaves the base image's original 197–212 SQL files beside the fork
  files.
- Rehearse the exact final migration set on a consistent isolated database
  clone before any image build. TL313 owns that release gate and the later
  authoritative ARM64 build.

## Impact

The work changes the feature-branch source tree, migration files and references,
overlay base pins, focused regression tests, OpenSpec, and release evidence. It
does not build or publish an image, change the serving container, touch the
production database, or enable/dispatch the release workflow. Deployment
rollback requires restoring the pre-migration database snapshot together with
the prior image; switching only the application image cannot undo schema/data
changes.
