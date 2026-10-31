import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MODEL_LOCKOUT_SETTINGS,
  resolveModelLockoutSettings,
} from "../../src/lib/resilience/modelLockoutSettings.ts";

test("omitted model lockout settings enable the existing timeout policy", () => {
  const settings = resolveModelLockoutSettings(undefined);

  assert.equal(settings.enabled, true);
  assert.ok(settings.errorCodes.includes(504));
  assert.equal(settings.baseCooldownMs, 120_000);
  assert.equal(settings.maxCooldownMs, DEFAULT_MODEL_LOCKOUT_SETTINGS.maxCooldownMs);
  assert.equal(settings.maxBackoffSteps, DEFAULT_MODEL_LOCKOUT_SETTINGS.maxBackoffSteps);
  assert.equal(
    settings.useExponentialBackoff,
    DEFAULT_MODEL_LOCKOUT_SETTINGS.useExponentialBackoff
  );
});

test("explicit modelLockout.enabled=false remains an opt-out", () => {
  assert.equal(resolveModelLockoutSettings({ modelLockout: { enabled: false } }).enabled, false);
});
