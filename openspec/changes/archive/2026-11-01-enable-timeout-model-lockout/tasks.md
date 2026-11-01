# Native configuration and acceptance tasks

- [x] Select the existing server setting `modelLockout.enabled=true`; keep
      source defaults `false`.
- [x] Preserve native error codes `403,404,429,502,503,504`, 120000 ms base,
      1800000 ms maximum, 10 exponential steps, and existing tuple semantics.
- [x] Preserve prior native settings PATCH/GET and scoped regression receipts.
- [x] Align proposal, design, tasks, and spec delta with the selected native
      configuration. Historical custom-source claims remain in
      `completion.review` as superseded receipts.
- [x] Complete passive runtime acceptance after the authorized release retry;
      see the exact source, artifact, configuration, and metadata gates in
      `openspec/TODO.md`.
- [x] Archive only after the runtime gates and package review are accepted.

## Final acceptance and archive authorization (2026-11-01)

Parent accepted source, prior scoped regressions/reviews, and actual runtime
release `dcc79e26476434ef0e0bcb5d49be50798c58c0fd` on immutable image
`sha256:52d86f2c8b9847088a5e2b37ac7c5a82a429a6f1ff22f6cfed5014ab140407e7`.
Attempt 2 succeeded; the owner selected stock automatic credential-health checks.
Earlier runtime/health holds are resolved. Historical manual inference, queue,
normalization, forced-tool, and billing work remains suspended and is not a
package-closure requirement. This closure ran no source tests or runtime actions.
