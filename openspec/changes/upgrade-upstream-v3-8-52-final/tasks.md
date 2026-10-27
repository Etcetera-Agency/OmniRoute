# Implementation Tasks

1. [x] Verify the final GitHub `v3.8.52` tag, commit, previous fork base, and
       official OCI index/ARM64 digest from canonical sources.
2. [x] Record one selected reconciliation, migration map, preserved fork
       invariants, release boundary, and database rollback path in this package.
3. [x] Add focused failing tests for the exact 197–216 migration inventory,
       mapped upstream order, absence of original upstream filenames, and both
       overlay base pins.
4. [ ] Rebase the isolated branch from the merged benchmark fix onto exact
       commit `ad6f33f66bda34eba98645d3bfdabbde294bc843`, resolving every
       conflict while preserving upstream release behavior and fork features.
5. [ ] Keep fork migration files 197–199 unchanged; map official 197–212 to
       200–215 and pending fork 200 to 216. Update migration hooks, physical
       schema checks, number guards, test fixtures, and version references.
6. [ ] Pin both overlay base references to
       `ghcr.io/diegosouzapw/omniroute@sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c`;
       update the OpenSpec base requirement and source-validation baseline.
7. [ ] Verify exact source and overlay migration inventories and preserve the
       official migration order and SQL effects, including FTS5 and credential
       migration behavior.
8. [ ] Run targeted upstream migration, benchmark-current snapshot,
       `benchmark_fitness`, strict free-only Auto-band, capability, and overlay
       regressions. Compare repository-wide failures against the pre-change
       branch.
9. [ ] Run Code Simplifier, fix findings that preserve the requirements, and
       update the root and package `completion.review` evidence.
10. [ ] Complete a fresh independent review; record and fix any material
        findings, run the affected checks, and keep TODO current.
11. [ ] Commit the reviewed local candidate with proposal, tests, implementation,
        updated specs, TODO, and completion evidence. Do not push or merge.
12. [ ] After the reviewed merge, TL313 rehearses the exact migration set on an
        isolated production DB clone, captures rollback evidence, and gates any
        final ARM64 image build. No source-only check substitutes for that
        rehearsal.
