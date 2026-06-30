# Implementation Tasks

- [x] `src/lib/fmoPools/capacity.ts` — rekey `WORKLOAD_CLASS_WEIGHTS` to the contract
      vocabulary (`light`, `chat`, `reasoning`, `tools`) + a `default` fallback; pick
      sensible defaults (`light` < `chat` ≈ global, `reasoning`/`tools` heavier).
- [x] Identify the request-path observation source (call-logs / usage aggregation) that
      already carries per-window total tokens and request counts.
- [x] Call `observeFmoTokensPerRequest(observedTokens, observedRequests)` from that path
      (or a periodic aggregator) so the global factor tracks real traffic.
- [x] Persist `globalTokensPerRequest`: load the last value on startup (seed from 2000
      when absent); write it when it changes. Keep `resetFmoTokensPerRequestForTests`.
- [x] Tests (`tests/unit/fmo-pools-planning.test.ts` or new): `chat`/`reasoning`/`tools`
      resolve to their own weights, not `default`; an observation moves the global factor
      and is clamped; `max(class, global)` still holds (light cannot understate global);
      persisted factor survives a simulated restart.
