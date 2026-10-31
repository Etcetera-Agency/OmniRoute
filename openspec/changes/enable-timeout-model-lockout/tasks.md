# Native configuration and acceptance tasks

- [x] Select the existing server setting `modelLockout.enabled=true`; keep
      source defaults `false`.
- [x] Preserve native error codes `403,404,429,502,503,504`, 120000 ms base,
      1800000 ms maximum, 10 exponential steps, and existing tuple semantics.
- [x] Preserve prior native settings PATCH/GET and scoped regression receipts.
- [x] Align proposal, design, tasks, and spec delta with the selected native
      configuration. Historical custom-source claims remain in
      `completion.review` as superseded receipts.
- [ ] Complete passive runtime acceptance after the authorized release retry;
      see the exact source, artifact, configuration, and metadata gates in
      `openspec/TODO.md`.
- [ ] Archive only after the runtime gates and package review are accepted.
