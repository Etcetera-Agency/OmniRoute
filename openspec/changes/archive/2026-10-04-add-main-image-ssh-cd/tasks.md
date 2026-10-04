# Implementation Tasks

## 1. Focused failing checks

- [x] 1.1 Add focused manual or isolated harness cases for publisher output
      gating, source freshness, digest/SHA/run/attempt validation, key creation
      ordering, exact SSH command, and heredoc payload.
- [x] 1.2 Add forced-command cases for wrong SSH command, malformed tuple,
      extra field, extra line/byte, and hostile shell text; each must stop before
      sudo or Compose.
- [x] 1.3 Add transaction-state cases for pull failure, backup failure,
      migration/acceptance failure, duplicate reattach, rerun attempt separation,
      lock contention, SSH disconnect, and rollback failure.
- [x] 1.4 Rehearse with a cloned production-format SQLite DB: remove only
      migration 196's ledger row in the copy, start the actual candidate so the
      real migration writes, fail its loopback dashboard probe with fixture-only
      config, and compare restored DB-file SHA-256 with protected backup-file
      SHA-256 immediately after atomic restore and before the prior image starts.
- [x] 1.5 Add focused resolved-runtime projection and app-only dry-run cases:
      allow historical metadata differences; reject effective app/Redis drift,
      candidate changes beyond its image, and unknown or mutating dry-run plans.
- [x] 1.6 Add private container-loopback UI/API probe regressions, host public
      dashboard checks, and the fixture's real public-404 rollback case without
      changing the production gateway binding.
- [x] 1.7 Verify fixture no-publication/internal-network validation, literal
      loopback proxy URL constraints, and actual unpublished-port runtime shape;
      preserve the real public-404 migration/rollback trigger.

- [x] 1.8 Add focused RED/GREEN standalone WAL snapshot cases: writable
      native parent with read-only SQL and exact numeric owner/group; cleanup
      only newly created matching-owner regular sidecars; unchanged hash/mode;
      reject existing/dangling companions and leave live read-only mount intact.

- [x] 1.9 Reproduce live readonly validator owner mismatch and verify exact
      DB UID/GID with a regular-file lstat, unchanged full-directory RO mount,
      readonly SQL, actual WAL/SHM preservation, and no owner fallback.

- [x] 1.10 Exercise actual fixture and production submit entrypoints with a
      Request object. Require canonical terminal run-attempt tokens and exit
      codes; never stringify the full Request into the wire result. Verify
      same-tuple reattach leaves a completed journal/unit unchanged.

## 2. Runner and workflow

- [x] 2.1 Add the tracked runner helper. Validate digest, 40-character source
      SHA, bounded positive run ID and attempt before writing temporary
      credentials or invoking SSH. Recheck canonical main immediately before
      transport and record SKIPPED_STALE without SSH on mismatch.
- [x] 2.2 Export image_digest and main_tag_updated from the existing publisher
      job. Add a production deploy job gated on successful publication, main-tag
      update, canonical repository, and exact main ref.
- [x] 2.3 Restrict the GitHub production Environment to main. Put the private
      key and pinned known-hosts value only in the SSH step. Check out github.sha
      with persisted credentials disabled and contents-read permission.
- [x] 2.4 Remove workflow-wide concurrency; retain canceling concurrency only
      on publisher. Add one static non-canceling production deploy group.
- [x] 2.5 Pin the server key and enforce strict SSH options. Send fixed command
      deploy-main with the four-field, single-line request. Keep runner timeout
      above bounded pull, health, route, and result wait budgets.

## 3. Restricted server boundary

- [x] 3.1 Provision omniroute-deploy with one forced rootless gate and
      explicit no-TTY/no-forwarding restrictions. Add an exact no-argument
      sudoers entry for the root-owned launcher; grant no Docker or data access.
- [x] 3.2 Install the gate, launcher, and transaction program at the fixed
      paths in the design. Validate the command and tuple at both gate and root
      boundary; construct the image ref only on the host.
- [x] 3.3 Copy the effective production Compose inputs into durable
      root-owned files under /etc/omniroute-deploy/compose/ and verify the copies
      render the currently running project. Install root-only config,
      diagnostic/status paths, and host flock. Install the systemd transaction
      and exact-tuple reattachment; keep it running after SSH or runner disconnect.
- [x] 3.4 Add a separate root-admin-only fixture CLI/profile. Enforce root
      ownership and mode 0600, unique Compose project, cloned data, internal
      networks without published ports, loopback proxy, and fixture-root-only mounts. Do not expose fixture paths or
      acceptance overrides to SSH.

## 4. Transaction, database, and rollback

- [x] 4.1 Pull the immutable digest; verify ARM64, digest, source/revision, and
      pinned-base labels. Use fixed root-owned Compose copies and confirm app-only
      change plus unchanged Redis before stopping.
- [x] 4.2 After acquiring the lock, check current canonical main from the
      public GitHub ref API immediately before app stop. Persist SKIPPED_STALE
      and exit without app/DB mutation on mismatch.
- [x] 4.3 Stop only the app, create a fresh root-only SQLite online backup,
      hash and validate it natively, capture DB metadata/prior image/config, then
      persist rollback state and candidate_may_mutate=true.
- [x] 4.4 Start only the candidate by digest with no build, no dependencies,
      and no pull; run startup migrations and bounded health, UI, API-auth,
      SQLite integrity, foreign-key, migration-ID, and Redis checks.
- [x] 4.5 On acceptance, atomically persist the image-only digest and terminal
      SUCCEEDED status. On post-migration failure, preserve a root-only candidate
      DB diagnostic snapshot, clear candidate WAL/SHM, restore the fresh DB
      backup and prior image/config, and verify the old service.
- [x] 4.6 If DB restoration or old-image acceptance fails, keep the app
      stopped, preserve all recovery artifacts, and record terminal FAILED with
      a bounded rollback-failure reason.

## 5. Rehearsal, production proof, and archive

- [x] 5.1 Run focused transport/gate/state-machine cases and the real-migration
      isolated fixture rehearsal. Confirm failure paths preserve logs without
      secrets or DB contents.
- [x] 5.2 Provision the production key, pinned known-hosts value, main-only
      Environment, and server helper/config. Verify durable root-owned Compose
      copies, runtime-web image identity, backup location, and local health probes.
- [x] 5.3 Deploy a current-main image through the normal workflow. Verify
      automatic production deployment, terminal run-attempt status,
      dashboard/API behavior, DB checks, and unchanged Redis.
- [x] 5.4 Record deferred backup-retention policy work in repo-level
      openspec/TODO.md; keep that file in any implementation commit.
- [x] 5.5 Use Code Simplifier before each implementation commit. If it causes
      fixes, update completion.review. Do not push without user approval.
- [x] 5.6 Archive only after the production run proves automatic deployment
      and required review/record updates are complete.
