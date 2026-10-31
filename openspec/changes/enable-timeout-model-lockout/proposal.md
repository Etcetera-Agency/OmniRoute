# Enable native model lockout on the production server

## Why

Upstream already handles ordinary504 and synthetic target timeouts with model
lockout and Auto pool exclusion. Both backend and UI source defaults are false.
Owner selected runtime configuration rather than changing these defaults.

## What Changes

Use the existing authenticated settings PATCH to persist modelLockout.enabled=true.
Preserve current error codes and cooldown/backoff values. Leave backend/UI defaults,
recording predicates, target executor and Auto filtering unchanged.

## Impact

No production source changes for lockout. Existing Reset Defaults still selects
upstream false in the UI draft until Save. The official backend-overlay image
retains official UI; no claim that a fork UI source edit would ship is made.

## Verification

Production settings PATCH and GET both return200; persisted enabled=true with
[403,404,429,502,503,504], base120000ms, max1800000ms, steps10, exponentialtrue.
Historical fork-owned tests cover configured native 504/target-timeout lockout,
Auto pool exclusion, and expiry; their receipts remain in `completion.review`.
Do not change upstream tests or add an `upstream_response_failed` 504 exception.
