# Implementation Tasks

- [x] `src/lib/fmoPools/packing.ts` — sort pools by specificity/scarcity; cross-pool reservation of rare exact-fit candidates for stricter pools.
- [x] Fill ladder: exact-fit in-band → relax band within `max_delta` → higher-capability overflow; hard gates never relax; overflow only after stricter pools covered.
- [x] Within-step ranking via autoCombo `scorePool` (quota/health/cost/latency/taskFit/stability); incumbency margin = `stability` factor; account stickiness hard rule.
- [x] Place-first quota-learning canary (tier 4): seat first, known capacity below, not counted toward coverage; never treated as an unrated-score canary.
- [x] Eligibility drop of degraded incumbents via cooldown/breaker/lockout reads; no-mix (all-pinned-or-all-unpinned) per provider.
- [x] `src/lib/fmoPools/tail.ts` — read approved tail config; filter by pool capabilities/context; append account-unpinned after head; never count as capacity.
- [x] Tail disjoint-class guard: drop + log any tail entry whose provider is account-pinned in this generation's head.
- [x] Solve emits per-combo plan (`head + tail`) + decision records; no combo write in this slice.
- [x] Tests: rare candidate reserved for strict pool; relax precedes overflow; hard gate never relaxed; canary seated first/not counted; incumbent kept within margin / degraded dropped; tail unpinned+uncounted; tools pool keeps capability in tail; misconfig guard drops+logs.
