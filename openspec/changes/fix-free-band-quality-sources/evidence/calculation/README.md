# Reproduce the free-band quality snapshot

Run from the OmniRoute repository root. Inputs are the frozen JSON files in
the parent `evidence/` directory. No model inference, API write, or live server
change is part of this calculation.

Run offline unit tests:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 tests/unit/aa-band-quality/test_aa_band_coverage.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/unit/aa-band-quality/test_unified_fitness.py
```

Recalculate AA profile reports:

```bash
python3 openspec/changes/fix-free-band-quality-sources/evidence/calculation/coverage.py report \
  --aa openspec/changes/fix-free-band-quality-sources/evidence/aa-current.json \
  --candidates openspec/changes/fix-free-band-quality-sources/evidence/current-candidates.json \
  --mappings openspec/changes/fix-free-band-quality-sources/evidence/aa-mappings.json \
  --metadata openspec/changes/fix-free-band-quality-sources/evidence/aa-public-metadata.json \
  --fork-filter openspec/changes/fix-free-band-quality-sources/evidence/fork-reasoning-filter.json \
  --profile reasoning-low \
  --out openspec/changes/fix-free-band-quality-sources/evidence/aa-low.json
```

Repeat with `reasoning-medium` / `aa-medium.json` and
`reasoning-high` / `aa-high.json`. Then build each unified profile and the
runtime score table:

```bash
python3 openspec/changes/fix-free-band-quality-sources/evidence/calculation/unify_fitness.py --profile low
python3 openspec/changes/fix-free-band-quality-sources/evidence/calculation/unify_fitness.py --profile medium
python3 openspec/changes/fix-free-band-quality-sources/evidence/calculation/unify_fitness.py --profile high
python3 openspec/changes/fix-free-band-quality-sources/evidence/calculation/build_runtime_snapshot.py \
  --output open-sse/services/autoCombo/bands/benchmarkConsensusFitness.ts
```

The AA API's documented Free row uses `name` for its displayed configuration
label (example: `gpt-oss-20B (high)`). This parser prefers recognized suffixes
from that API name; paired chart metadata fills only missing suffixes. For the
generic high reference population, a `high` row wins over `xhigh`. Candidate
scores instead use the exact effort selected by the Hermes reasoning audit;
mapped `xhigh` stays `xhigh` when a `high` sibling exists. If the mapped row is
missing, the sibling score is marked as a proxy; missing evidence is never
zero. The evidence manifest records SHA-256 hashes for frozen inputs, reports,
and the generated runtime table.
