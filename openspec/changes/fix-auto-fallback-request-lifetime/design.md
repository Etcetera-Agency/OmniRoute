# Selected native configuration

## Source-grounded policy

resolveComboConfig merges DEFAULT_COMBO_CONFIG, settings.comboDefaults, provider
override and concrete combo config. Virtual Auto bands do not override the total
timeout, so saved comboDefaults.comboTimeoutMs applies. A positive setting replaces
the implicit600000ms loop safety window. Preserve the native implementation.

```text
GET existing settings with management credential
PATCH /api/settings/combo-defaults:
  comboDefaults = { ...existing comboDefaults, comboTimeoutMs:1200000 }
GET settings and assert saved timeout1200000 and modelLockout.enabled=true
```

Do not change targetTimeoutMs, maxGlobalAttempts, candidate pool, scoring, error
classification, provider credentials or paid-routing policy. Native first calls
and retries share the default30 total cap, hard200. The existing three-identical-
model error guard remains unchanged; this change adds no error-class semantics.

## Benchmark boundary

processModelBenchmarkSearchResults builds auto/general_high_so:free and invokes
handleChat directly. NORMALIZATION_TIMEOUT_MS is1200000. The API bridge is not in
this path. A catalog model without direct benchmark evidence may reach optional
source discovery; out-of-catalog IDs stop at the existing eligibility gate.

The fourth regression scales selected timers1000:1: first local target timeout
400000, fallback delay250000, total650000, below the caller1200000. It verifies
first-target abort, distinct eligible second model and normalized evidence.
The same test passes on original ceef1b0377 loop with saved1200000, proving the
source safety-cap removal is unnecessary. All original production files restored.

## Other regressions

Immediate504 fallback returns the successful candidate's evidence; exhaustion
returns the native aggregate failure to the caller and settles queue work with a
normalization error; the next Auto request skips the cooled tuple. Mock sources
and models are isolated fixtures, never published as actual benchmark results.
Call logs attribute the internal-probe key and output tokens; usage_history is
not separately asserted. Queue stores a generic HTTP error, not the full
aggregate body.

## Runtime state

Native settings PATCH200 and GET200 verify timeout1200000 and lockoutenabledtrue.
Live source remains455442b05754, healthy; no source deployment needed for these
settings. Source files under src/open-sse have zero diff versus original BASE.
Long-timer test is local accelerated evidence, not live inference acceptance.
