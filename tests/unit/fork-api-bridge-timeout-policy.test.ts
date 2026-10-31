import assert from "node:assert/strict";
import test from "node:test";

const { getApiBridgeTimeoutConfig } = await import("../../src/shared/utils/runtimeTimeouts.ts");

const defaultForwardingTimeouts = {
  proxyTimeoutMs: 600_000,
  serverRequestTimeoutMs: 600_000,
};

test("upstream API bridge default timeouts remain unchanged", () => {
  const config = getApiBridgeTimeoutConfig({});

  assert.equal(config.proxyTimeoutMs, defaultForwardingTimeouts.proxyTimeoutMs);
  assert.equal(config.serverRequestTimeoutMs, defaultForwardingTimeouts.serverRequestTimeoutMs);
});

test("upstream forwarding timeout overrides remain unchanged", () => {
  const requestTimeout = getApiBridgeTimeoutConfig({ REQUEST_TIMEOUT_MS: "120000" });
  assert.equal(requestTimeout.serverRequestTimeoutMs, 300_000);

  const proxyTimeout = getApiBridgeTimeoutConfig({ API_BRIDGE_PROXY_TIMEOUT_MS: "450000" });
  assert.equal(proxyTimeout.proxyTimeoutMs, 450_000);

  const serverRequestTimeout = getApiBridgeTimeoutConfig({
    API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS: "700000",
  });
  assert.equal(serverRequestTimeout.serverRequestTimeoutMs, 700_000);
});

test("zero retains each explicit API bridge timeout override semantics", () => {
  const requestTimeout = getApiBridgeTimeoutConfig({ REQUEST_TIMEOUT_MS: "0" });
  assert.equal(requestTimeout.proxyTimeoutMs, 0);
  assert.equal(requestTimeout.serverRequestTimeoutMs, 0);

  const proxyTimeout = getApiBridgeTimeoutConfig({ API_BRIDGE_PROXY_TIMEOUT_MS: "0" });
  assert.equal(proxyTimeout.proxyTimeoutMs, 0);
  assert.equal(proxyTimeout.serverRequestTimeoutMs, 300_000);

  const serverRequestTimeout = getApiBridgeTimeoutConfig({
    API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS: "0",
  });
  assert.equal(serverRequestTimeout.proxyTimeoutMs, 600_000);
  assert.equal(serverRequestTimeout.serverRequestTimeoutMs, 0);
});

test("blank timeout overrides are treated as unset", () => {
  for (const name of [
    "REQUEST_TIMEOUT_MS",
    "API_BRIDGE_PROXY_TIMEOUT_MS",
    "API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS",
  ]) {
    const config = getApiBridgeTimeoutConfig({ [name]: "  " });

    assert.equal(config.proxyTimeoutMs, defaultForwardingTimeouts.proxyTimeoutMs);
    assert.equal(config.serverRequestTimeoutMs, defaultForwardingTimeouts.serverRequestTimeoutMs);
  }
});

test("invalid timeout overrides fall back to current defaults", () => {
  for (const [name, expected] of [
    ["REQUEST_TIMEOUT_MS", defaultForwardingTimeouts],
    ["API_BRIDGE_PROXY_TIMEOUT_MS", defaultForwardingTimeouts],
    ["API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS", defaultForwardingTimeouts],
  ]) {
    const config = getApiBridgeTimeoutConfig({ [name]: "invalid" });

    assert.equal(config.proxyTimeoutMs, expected.proxyTimeoutMs);
    assert.equal(config.serverRequestTimeoutMs, expected.serverRequestTimeoutMs);
  }
});

test("explicit fractional timeout values are floored by the upstream resolver", () => {
  const config = getApiBridgeTimeoutConfig({ API_BRIDGE_PROXY_TIMEOUT_MS: "450000.9" });

  assert.equal(config.proxyTimeoutMs, 450_000);
});

test("native gateway-only zero settings disable forwarding without changing provider defaults", async () => {
  const env = { API_BRIDGE_PROXY_TIMEOUT_MS: "0", API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS: "0" };
  const config = getApiBridgeTimeoutConfig(env);
  assert.equal(config.proxyTimeoutMs, 0);
  assert.equal(config.serverRequestTimeoutMs, 0);
  const { getUpstreamTimeoutConfig } = await import("../../src/shared/utils/runtimeTimeouts.ts");
  assert.deepEqual(getUpstreamTimeoutConfig(env), getUpstreamTimeoutConfig({}));
});
