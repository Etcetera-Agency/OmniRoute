# Design: Full-source identity for the compiled backend overlay

## Chosen flow

The workflow passes `github.sha` as `OMNIROUTE_BUILD_SHA`. The Dockerfile keeps
that argument out of `backend-dependencies`, so changing source identity does
not invalidate `npm ci` or the native SQLite dependency layer. In
`backend-builder`, the Dockerfile declares the argument only after `COPY . ./`
and validates it before `npm run build:backend`:

```text
COPY . ./
ARG OMNIROUTE_BUILD_SHA
validate-only(OMNIROUTE_BUILD_SHA)
compile backend
write existing BUILD_SHA into backend standalone output
copy standalone/BUILD_SHA to backend server/BUILD_SHA
```

The existing writer remains the single source of stamp formatting. Its
validate-only mode is read-only and accepts exactly 40 lowercase hexadecimal
characters. It does not resolve a short local Git SHA or create a placeholder
when the Docker argument is missing or malformed.

## Builder and prebuilt contract

Both backend sources flow through `selected-backend` into `merged-backend`.
The regular builder copies its writer-produced stamp into the compiled server
tree. A separately produced `backend_export` must already include
`/server/BUILD_SHA`; the existing scratch adapter stays available and does not
invoke `backend-builder`. `merged-backend` verifies the selected stamp against
the same full build argument before route-manifest merging or final runtime
copy:

```text
expected = require_full_lowercase_sha(OMNIROUTE_BUILD_SHA)
observed = read(selected_server/BUILD_SHA)
if observed != expected: fail the Docker build
```

There is no unstamped-export compatibility branch. Exports without a stamp,
with a short stamp, or with a different revision stop the build before a
runtime image can be produced.

## Final image check

After inspecting the candidate's image configuration and before native checks
or candidate startup, the verifier runs a single `node` process from the
candidate image with `--network none`, `--read-only`, all Linux capabilities
dropped, `no-new-privileges`, and bounded CPU, memory, and PID use. The process
reads only
`/app/.build/next/omni-overlay/server/BUILD_SHA` and writes only the SHA to
stdout. The verifier requires:

```text
candidate server BUILD_SHA == expected full source SHA
candidate server BUILD_SHA == candidate OCI revision label
```

Diagnostics do not include environment values or arbitrary stamp contents.
The verifier fails before the app container starts when the stamp is absent,
malformed, or mismatched.

## Evidence boundary

Focused CLI and verifier tests prove validation and failure behavior. A real
Linux ARM64 build is still required to measure the resulting tuple:
`source commit`, `server/BUILD_SHA`, OCI revision, compiled route hash, image
digest, and published tag. Do not infer a Linux ARM64 build identity from a
native macOS build or update SDK pins before that tuple is measured.
