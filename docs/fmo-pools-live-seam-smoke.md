# FMO Pools Live Seam Smoke

Use this after deploying the fork with `OMNIROUTE_FMO_POOLS_ENABLED=true` and a
management session/key available.

```bash
BASE_URL="${BASE_URL:-http://127.0.0.1:20128}"
BRIDGE_URL="${BRIDGE_URL:-http://127.0.0.1:20129}"
PAYLOAD="${PAYLOAD:-tests/fixtures/fmo/fmo-pools-v1.golden.json}"
KEY="$(shasum -a 256 "$PAYLOAD" | awk '{print $1}')"

curl -fsS -X PUT "$BRIDGE_URL/api/fmo/pools" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OMNIROUTE_MANAGEMENT_TOKEN" \
  -H "Idempotency-Key: $KEY" \
  --data-binary "@$PAYLOAD" | jq .

curl -fsS "$BASE_URL/api/fmo/status" \
  -H "authorization: Bearer $OMNIROUTE_MANAGEMENT_TOKEN" | jq .
```

Expected:

- Pool publish returns `status: "accepted"` and `applied: true`.
- Status returns `kind: "fmo_pool_execution_status"`, `demandFeedback: false`, the
  accepted generation, the applied generation, last diff data, and decision summary.
- Repeating the same `PUT /api/fmo/pools` request returns a fresh applied result.
- There is no public `POST /api/fmo/rebalance` route; self-rebalance uses the startup
  FMO timer and the accepted generation's `rebalance.interval_minutes`.
