import test from "node:test";
import assert from "node:assert/strict";

import { handleComboChat } from "../../open-sse/services/combo.ts";
import { resolveComboTargetTimeoutMsForCombo } from "../../open-sse/services/comboConfig.ts";
import { resetAllCircuitBreakers } from "../../src/shared/utils/circuitBreaker.ts";
import * as providersDb from "../../src/lib/db/providers.ts";
import { resolveResilienceSettings } from "../../src/lib/resilience/settings.ts";

const noop = () => {};
const log = { info: noop, warn: noop, debug: noop, error: noop };
const body = { stream: false, messages: [{ role: "user", content: "ping" }] };

function success(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function failure(status: number, model: string): Response {
  return new Response(
    JSON.stringify({ error: { message: `${model} failed`, type: "upstream_error" } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function combo(models: string[], config: Record<string, unknown> = {}, strategy = "auto") {
  return {
    name: `auto-fallback-lifetime-${Math.random().toString(36).slice(2)}`,
    strategy,
    models,
    config: { explorationRate: 0, maxRetries: 0, retryDelayMs: 0, fallbackDelayMs: 0, ...config },
  };
}

async function run(
  models: string[],
  handleSingleModel: Parameters<typeof handleComboChat>[0]["handleSingleModel"],
  config: Record<string, unknown> = {},
  options: Partial<Parameters<typeof handleComboChat>[0]> = {},
  strategy = "auto"
) {
  return handleComboChat({
    body,
    combo: combo(models, config, strategy),
    handleSingleModel,
    isModelAvailable: async () => true,
    log,
    settings: null,
    allCombos: null,
    ...options,
  });
}

test.beforeEach(() => resetAllCircuitBreakers());

test("non-streaming Auto falls through HTTP 504 and returns later success body", async () => {
  const calls: string[] = [];
  const response = await run(["alpha/a", "beta/b"], async (_body, model) => {
    calls.push(model);
    return calls.length === 1 ? failure(504, model) : success("later success");
  });

  assert.deepEqual([...calls].sort(), ["alpha/a", "beta/b"]);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /later success/);
});

test("target timeout abort stays local and does not abort next Auto candidate", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const calls: string[] = [];
  let firstTargetAborted = false;
  let targetTimeoutCallback: (() => void) | null = null;
  let releaseFirstDispatch!: () => void;
  const firstDispatch = new Promise<void>((resolve) => {
    releaseFirstDispatch = resolve;
  });
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 5) {
      targetTimeoutCallback = () => typeof callback === "function" && callback(...args);
      return 1 as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(callback, delay, ...args);
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
    if (timer === 1) return;
    return originalClearTimeout(timer);
  }) as typeof clearTimeout;

  try {
    const responsePromise = run(
      ["alpha/slow", "beta/fast"],
      async (_body, model, target) => {
        calls.push(model);
        if (model === "alpha/slow") {
          return new Promise<Response>((resolve) => {
            target?.modelAbortSignal?.addEventListener(
              "abort",
              () => {
                firstTargetAborted = true;
                resolve(new Response(null, { status: 599 }));
              },
              { once: true }
            );
            releaseFirstDispatch();
          });
        }
        assert.equal(target?.modelAbortSignal?.aborted, false);
        return success("after timeout");
      },
      { targetTimeoutMs: 5 }
    );

    await firstDispatch;
    assert.ok(targetTimeoutCallback, "the finite per-target timeout must be armed");
    targetTimeoutCallback();
    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.equal(firstTargetAborted, true);
    assert.deepEqual(calls, ["alpha/slow", "beta/fast"]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("Auto nonpositive target timeout uses finite combo target default and falls through", async () => {
  const resilienceSettings = resolveResilienceSettings(null);
  const resolvedAutoTargetTimeoutMs = resolveComboTargetTimeoutMsForCombo(
    undefined,
    600_000,
    "auto",
    resilienceSettings.comboCooldownWait
  );
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let targetTimeoutCallback: (() => void) | null = null;
  let targetTimeoutMs: number | undefined;
  const calls: string[] = [];
  let firstTargetAborted = false;

  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === resolvedAutoTargetTimeoutMs) {
      targetTimeoutMs = delay;
      targetTimeoutCallback = () => typeof callback === "function" && callback(...args);
      return 1 as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(callback, delay, ...args);
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
    if (timer === 1) return;
    return originalClearTimeout(timer);
  }) as typeof clearTimeout;
  try {
    const response = await run(
      ["finite-timeout/slow", "finite-timeout/next"],
      async (_body, model, target) => {
        calls.push(model);
        if (calls.length > 1) return success("finite timeout fallback");
        return new Promise<Response>((resolve) => {
          target?.modelAbortSignal?.addEventListener(
            "abort",
            () => {
              firstTargetAborted = true;
              resolve(new Response(null, { status: 599 }));
            },
            { once: true }
          );
          if (targetTimeoutCallback) targetTimeoutCallback();
          else resolve(new Response(null, { status: 599 }));
        });
      },
      { targetTimeoutMs: 0 }
    );

    assert.equal(resolvedAutoTargetTimeoutMs, 310_000);
    assert.equal(targetTimeoutMs, resolvedAutoTargetTimeoutMs);
    assert.equal(firstTargetAborted, true);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /finite timeout fallback/);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("multiple upstream 504 responses do not prevent a later Auto success", async () => {
  const calls: string[] = [];
  const models = ["multi-alpha/a", "multi-beta/b", "multi-gamma/c"];
  const response = await run(models, async (_body, model) => {
    calls.push(model);
    return model === models[2] ? success("third candidate") : failure(504, model);
  });

  assert.deepEqual(calls, models);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /third candidate/);
});

test("exhausted Auto aggregate keeps failed model identities and HTTP statuses", async () => {
  const models = ["aggregate-alpha/a", "aggregate-beta/b", "aggregate-gamma/c"];
  const calls: string[] = [];
  const statusFor = (model: string) =>
    model === models[0] ? 504 : model === models[1] ? 503 : 502;
  const response = await run(models, async (_body, model) => {
    calls.push(model);
    return failure(statusFor(model), model);
  });

  assert.deepEqual([...calls].sort(), [...models].sort());
  assert.equal(response.status, statusFor(calls[calls.length - 1]));
  const aggregate = await response.text();
  for (const model of models) assert.match(aggregate, new RegExp(model));
  for (const status of ["504", "503", "502"]) assert.match(aggregate, new RegExp(status));
});

test("Auto inherits native20min budget beyond ten minutes accumulated target time", async () => {
  const originalNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let now = originalNow();
  const calls: string[] = [];
  const safetyDelays: number[] = [];
  Date.now = () => now;
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay !== undefined && delay >= 10 * 60 * 1000) {
      safetyDelays.push(delay);
      return 1 as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(callback, delay, ...args);
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
    if (timer === 1) return;
    return originalClearTimeout(timer);
  }) as typeof clearTimeout;
  try {
    const models = ["lifetime-alpha/first", "lifetime-beta/second", "lifetime-gamma/third"];
    const response = await run(
      models,
      async (_body, model) => {
        calls.push(model);
        now += 6 * 60 * 1000;
        return model === models[2] ? success("after ten minutes") : failure(504, model);
      },
      {},
      { settings: { comboDefaults: { comboTimeoutMs: 1_200_000 } } }
    );

    assert.equal(
      calls.length,
      3,
      `expected all three finite target attempts, got ${calls.join(", ")}`
    );
    assert.deepEqual(
      safetyDelays,
      [1_200_000],
      "native saved global deadline replaces implicit safety window"
    );
    assert.equal(response.status, 200);
    assert.match(await response.text(), /after ten minutes/);
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("Auto retains the upstream default total cap of 30 attempts", async () => {
  const models = Array.from({ length: 32 }, (_, index) => `cap-${index}/model-${index}`);
  const calls: string[] = [];
  const response = await run(models, async (_body, model) => {
    calls.push(model);
    return failure(503, model);
  });
  assert.equal(calls.length, 30);
  assert.equal(new Set(calls).size, 30);
  assert.equal(response.status, 503);
});

test("Auto retries consume the same upstream total attempt budget", async () => {
  const calls: string[] = [];
  const response = await run(
    ["cap-a/first", "cap-b/second"],
    async (_body, model) => {
      calls.push(model);
      return new Response("Internal Server Error", { status: 500 });
    },
    { maxRetries: 1, maxGlobalAttempts: 2 }
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
  assert.equal(response.status, 503);
});

test("Non-Auto keeps the configured total dispatch cap", async () => {
  const models = ["priority-alpha/a", "priority-beta/b", "priority-gamma/c"];
  const calls: string[] = [];
  const response = await run(
    models,
    async (_body, model) => {
      calls.push(model);
      return failure(503, model);
    },
    { maxRetries: 0, maxGlobalAttempts: 2 },
    {},
    "priority"
  );

  assert.deepEqual(calls, models.slice(0, 2));
  assert.equal(response.status, 503);
});

test("ordinary upstream 504 leaves same raw model eligible on uncooled allowed sibling connection", async () => {
  const provider = "openai";
  const rawModel = "gpt-4o-mini";
  const connections = await Promise.all(
    ["a", "b"].map((suffix) =>
      providersDb.createProviderConnection({
        provider,
        authType: "apikey",
        name: `auto-sibling-${suffix}-${Math.random().toString(36).slice(2)}`,
        apiKey: `auto-sibling-key-${suffix}`,
        isActive: true,
        testStatus: "active",
      })
    )
  );
  const connectionIds = connections.map((connection) => String(connection.id));
  const modelStr = `${provider}/${rawModel}`;
  const calls: string[] = [];
  const gatewayTimeout = new Response(
    JSON.stringify({
      error: { message: "Gateway Timeout", type: "server_error" },
    }),
    { status: 504, headers: { "Content-Type": "application/json" } }
  );
  const response = await handleComboChat({
    body,
    combo: {
      name: `same-model-sibling-${provider}`,
      strategy: "auto",
      models: connectionIds.map((connectionId, index) => ({
        kind: "model",
        provider,
        providerId: provider,
        model: rawModel,
        modelStr,
        connectionId,
        allowedConnectionIds: [connectionId],
        id: `sibling-${index}`,
      })),
      config: { maxRetries: 0, maxGlobalAttempts: 30, retryDelayMs: 0, fallbackDelayMs: 0 },
    } as unknown as Parameters<typeof handleComboChat>[0]["combo"],
    handleSingleModel: async (_body, model, target) => {
      calls.push(`${model}@${target?.connectionId}`);
      return calls.length === 1 ? gatewayTimeout.clone() : success("uncooled sibling success");
    },
    isModelAvailable: async () => true,
    log,
    settings: null,
    allCombos: null,
  });

  assert.equal(
    calls.length,
    2,
    `both allowed Auto connections should dispatch: ${calls.join(", ")}`
  );
  assert.deepEqual(new Set(calls), new Set(connectionIds.map((id) => `${modelStr}@${id}`)));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /uncooled sibling success/);
});

test("explicit positive comboTimeoutMs still bounds Auto dispatch", async () => {
  const calls: string[] = [];
  const response = await run(
    ["alpha/slow", "beta/never"],
    async (_body, model) => {
      calls.push(model);
      return new Promise<Response>((resolve) => setTimeout(() => resolve(failure(504, model)), 40));
    },
    { comboTimeoutMs: 5, targetTimeoutMs: 1000 }
  );

  assert.equal(response.status, 504);
  assert.equal(
    calls.length,
    1,
    `explicit deadline should allow one dispatch, got ${calls.join(", ")}`
  );
});

test("real client abort prevents subsequent Auto dispatch", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const response = await run(
    ["alpha/first", "beta/second"],
    async (_body, model) => {
      calls.push(model);
      controller.abort();
      return failure(504, model);
    },
    {},
    { signal: controller.signal }
  );

  assert.ok(
    response.status === 499 || response.status === 503,
    `unexpected cancellation status ${response.status}`
  );
  assert.deepEqual(calls, ["alpha/first"]);
});

test("Auto success stops all later candidate dispatch", async () => {
  const calls: string[] = [];
  const response = await run(["alpha/winner", "beta/later", "gamma/last"], async (_body, model) => {
    calls.push(model);
    return success("winner");
  });

  assert.deepEqual(calls, ["alpha/winner"]);
  assert.equal(response.status, 200);
});
