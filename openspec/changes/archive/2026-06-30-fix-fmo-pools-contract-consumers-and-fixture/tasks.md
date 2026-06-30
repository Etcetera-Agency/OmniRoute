# Implementation Tasks

- [x] `src/shared/schemas/fmoPools.ts` — `demand.consumers` →
      `z.number().int().positive().optional()` (count, not array); `demand.requests_per_day`
      → `z.number().finite().positive()` (accept FMO floats). Keep everything else strict.
- [x] `src/lib/db/fmoPools.ts` — confirm the spec→planning mapping passes `consumers`
      through as the numeric count.
- [x] Replace `tests/fixtures/fmo/fmo-pools-v1.golden.json` with the canonical shared
      fixture below — byte-identical to the FMO copy
      (`reference/fixtures/fmo-pools-v1-generation.json`):

  ```json
  {
    "contract_version": "fmo-pools/v1",
    "generation": "gen-001",
    "generated_at": "2026-06-29T00:00:00.000Z",
    "pools": [
      {
        "pool_id": "pool-fast",
        "combo_id": "combo-fast",
        "demand": { "requests_per_day": 1000, "consumers": 4, "workload_class": "reasoning" },
        "constraints": {
          "free_only": true,
          "capabilities": ["api:openai", "chat", "thinking", "tool_call"],
          "min_context_tokens": 32768,
          "quality_band": {
            "source": "model_intelligence",
            "metric": "score",
            "category": "coding",
            "min": 55,
            "max": 85,
            "relax": { "max_delta": 12, "when": "underfilled" }
          }
        },
        "tail": { "strategy": "auto", "mode": "fallback", "compatibility": "strict" }
      }
    ]
  }
  ```

- [x] `tests/unit/api/fmo-pools-contract.test.ts` — add a conformance test that loads the
      shared fixture and asserts `fmoPoolsGenerationSchema.safeParse(fixture).success` is
      `true` with no coercion; assert `consumers` accepted as a number and a string-array
      `consumers` rejected. The full-ingest test may substitute `combo_id` with a seeded
      combo; the schema-conformance test validates the fixture verbatim.
- [x] Document that the fixture is the single contract source of truth and must stay
      byte-identical with the FMO copy (drift fails the conformance test).
