# Native configuration and acceptance tasks

- [x] Select `comboDefaults.comboTimeoutMs=1200000` through native settings;
      preserve the native request loop and finite request lifetime.
- [x] Preserve the 30-attempt default (hard limit 200), existing
      three-identical-model guard, finite target deadlines, cancellation, and
      strict-free eligibility.
- [x] Preserve historical settings and offline regression receipts in
      `completion.review`.
- [x] Align proposal, design, tasks, and spec delta with the selected native
      configuration. Earlier custom-loop claims remain superseded history.
- [x] Complete passive runtime acceptance after the authorized release retry;
      see `openspec/TODO.md` for exact gates and current status.
- [x] Archive only after runtime gates and package review are accepted.

## Final acceptance and archive authorization (2026-11-01)

Parent accepted source, prior scoped regressions/reviews, and actual runtime
release `dcc79e26476434ef0e0bcb5d49be50798c58c0fd` on immutable image
`sha256:52d86f2c8b9847088a5e2b37ac7c5a82a429a6f1ff22f6cfed5014ab140407e7`.
Attempt 2 succeeded; the owner selected stock automatic credential-health checks.
Earlier runtime/health holds are resolved. Historical manual inference, queue,
normalization, forced-tool, and billing work remains suspended and is not a
package-closure requirement. This closure ran no source tests or runtime actions.
