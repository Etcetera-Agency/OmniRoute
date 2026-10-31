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
- [ ] Complete passive runtime acceptance after the authorized release retry;
      see `openspec/TODO.md` for exact gates and current status.
- [ ] Archive only after runtime gates and package review are accepted.
