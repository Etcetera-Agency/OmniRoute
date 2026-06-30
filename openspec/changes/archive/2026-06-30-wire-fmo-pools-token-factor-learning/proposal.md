# Change: Wire the tokens_per_request learning loop and align workload-class weights

## Why

The capacity comparator is specced as a **learned** factor:
"keep `tokens_per_request` a single global learned factor … compute capacity as
`max(workload_class weight, global factor)`" (capability `fmo-pool-rebalance`,
Requirement "Quota source precedence and request-equivalent capacity"). Two gaps make
the implementation diverge from that spec:

1. **The factor never learns.** `observeFmoTokensPerRequest()` exists in
   `src/lib/fmoPools/capacity.ts` but a repo-wide grep finds **no caller** outside
   `capacity.ts` itself. `globalTokensPerRequest` is therefore frozen at the
   `DEFAULT_TOKENS_PER_REQUEST = 2000` seed forever; no request-path observation ever
   updates it. The "learned" half of the requirement is unimplemented.

2. **The class-to-weight table does not match the contract vocabulary.** The contract
   (`fmo-pools/v1`) and the publisher emit `workload_class ∈ {light, chat, reasoning,
tools}`, but `WORKLOAD_CLASS_WEIGHTS` keys are `{light, default, coding, analysis,
long_context}`. `chat`, `reasoning`, and `tools` miss the table and silently fall to
   `default`, so the per-pool weight hint is inert for exactly the heavy/strict pools it
   exists to protect.

## What Changes

- `src/lib/fmoPools/capacity.ts` — replace `WORKLOAD_CLASS_WEIGHTS` keys with the
  contract vocabulary (`light`, `chat`, `reasoning`, `tools`) and keep a `default`
  fallback; `resolveFmoTokensPerRequest` keeps `max(class_weight, global_factor)`.
- Wire `observeFmoTokensPerRequest(observedTokens, observedRequests)` into the request
  path so the global factor learns from real `observed_tokens / observed_requests`
  (reuse the existing call-log / usage aggregation as the observation source; clamp
  stays as-is). Persist the learned factor across restarts (seed from the persisted
  value, else the 2000 default).
- No contract change; no change to the apply path.

## Impact

- **Capability**: `fmo-pool-rebalance` (Requirement "Quota source precedence and
  request-equivalent capacity").
- **Reused**: existing clamp/seed in `capacity.ts`; call-log/usage aggregation as the
  observation feed.
- **Net-new**: the observation→`observeFmoTokensPerRequest` wiring and factor
  persistence; the aligned weight table.
- **Coordinates with** FMO slice `align-fmo-publisher-quality-band-scale` (the publisher
  emits the class strings this table consumes).
