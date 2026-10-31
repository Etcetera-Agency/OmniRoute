# Chosen design

## Source and configuration

Both original upstream source defaults are false. Preserve those constants and
all upstream error recording and cooldown logic. GET settings returns raw stored
modelLockout or omits it; runtime applies defaults only to missing fields. PATCH
normalizes then persists the object. UI Reset Defaults changes a local draft,
not the database until Save. Official overlay packaging retains official UI.

```text
GET /api/settings with existing management credential
native = existing modelLockout object or empty
PATCH /api/settings { modelLockout: { ...native, enabled: true } }
GET /api/settings
assert persisted modelLockout.enabled == true
```

## Result

Completed PATCH200 and verification GET200 on 2026-10-31 without restart or deploy.
Canonical parameters are errorCodes403/404/429/502/503/504, base120000ms,
max1800000ms, maxBackoffSteps10 and exponentialtrue. Secrets remain remote.

## Historical source-scope receipt (superseded)

Backend/UI defaults, timeout recorder and predicate remain identical to original
base ceef1b0377. Removed unsupported upstream_response_failed504 exception,
synthetic test and fork-default UI regression. Existing native504 and local target
timeout logic remains covered with explicit configured enabled=true.
