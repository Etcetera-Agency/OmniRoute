import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createChatPipelineHarness } from "../integration/_chatPipelineHarness.ts";

const harness = await createChatPipelineHarness("auto-fallback-http-response");
const { BaseExecutor, resetStorage, seedConnection, settingsDb } = harness;
const core = await import("../../src/lib/db/core.ts");
const chatRoute = await import("../../src/app/api/v1/chat/completions/route.ts");
const modelIntelligenceDb = await import("../../src/lib/db/modelIntelligence.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");
const deadlineEnvNames = [
  "REQUEST_TIMEOUT_MS",
  "API_BRIDGE_PROXY_TIMEOUT_MS",
  "API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS",
];
const originalDeadlineEnv = deadlineEnvNames.map((name) => process.env[name]);
for (const name of deadlineEnvNames) delete process.env[name];
process.env.API_BRIDGE_PROXY_TIMEOUT_MS = "0";
process.env.API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS = "0";
const apiBridge = await import("../../src/lib/apiBridgeServer.ts");
let callerApiKey: string;

const requestBody =
  JSON.stringify(
    {
      model: "auto/coding_high_tools:free",
      stream: false,
      max_tokens: 64,
      messages: [{ role: "user", content: "Use the status tool once." }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_status",
            description: "Look up one status value.",
            parameters: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
        },
      ],
    },
    null,
    2
  ) + "\n";

const candidates = ["ind004-http-alpha:free", "ind004-http-beta:free"];
const providers = ["openrouter", "nvidia"];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, ms = 6000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`HTTP test barrier exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function seedFreeBand(): Promise<void> {
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  BaseExecutor.RETRY_CONFIG.delayMs = 0;
  const connections = await Promise.all(
    providers.map((provider, index) =>
      seedConnection(provider, {
        name: `${provider}-ind004-${index}`,
        apiKey: `test-ind004-${provider}-${index}`,
      })
    )
  );
  await settingsDb.updateSettings({
    blockedProviders: ["opencode", "duckduckgo-web", "veoaifree-web", "auggie"],
    comboDefaults: { targetTimeoutMs: 1500, maxRetries: 0, retryDelayMs: 0, fallbackDelayMs: 0 },
    freeAccessPolicy: "strict",
    modelLockout: { enabled: true },
    modelsDevSyncEnabled: true,
  });
  const db = core.getDbInstance();
  for (const [index, connection] of connections.entries()) {
    db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
      "syncedAvailableModels",
      `${providers[index]}:${connection.id}`,
      JSON.stringify([{ id: candidates[index], isFree: true }])
    );
  }
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    "models_dev_zero_price",
    "snapshot",
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      modelsByProvider: Object.fromEntries(
        providers.map((provider, index) => [provider, [candidates[index]]])
      ),
    })
  );
  for (const [index, model] of candidates.entries()) {
    modelsDevSync.upsertSyncedCapabilities(providers[index], {
      [model]: {
        tool_call: true,
        reasoning: null,
        attachment: null,
        structured_output: null,
        temperature: null,
        modalities_input: JSON.stringify(["text"]),
        modalities_output: JSON.stringify(["text"]),
        knowledge_cutoff: null,
        release_date: null,
        last_updated: null,
        status: null,
        family: null,
        open_weights: null,
        limit_context: null,
        limit_input: null,
        limit_output: null,
        interleaved_field: null,
      },
    });
    modelIntelligenceDb.upsertModelIntelligence({
      model,
      source: "models_dev_tier",
      category: "coding",
      score: 0.95,
      eloRaw: null,
      confidence: "high",
      expiresAt: null,
    });
  }
}

async function startHttpAdapter(
  viaBridge = false,
  bridgeModule = apiBridge,
  scaleOldWindow = true
) {
  const clientSignals: AbortSignal[] = [];
  const responses: http.ServerResponse[] = [];
  const rawBodies: Buffer[] = [];
  const incomingHeaders: http.IncomingHttpHeaders[] = [];
  const applicationFinished = deferred<void>();
  const server = http.createServer((incoming, outgoing) => {
    const controller = new AbortController();
    clientSignals.push(controller.signal);
    responses.push(outgoing);
    incoming.once("aborted", () => controller.abort());
    outgoing.once("close", () => {
      if (!outgoing.writableEnded) controller.abort();
    });

    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", async () => {
      try {
        const rawBody = Buffer.concat(chunks);
        rawBodies.push(rawBody);
        incomingHeaders.push(incoming.headers);
        const request = new Request(`http://127.0.0.1${incoming.url}`, {
          method: incoming.method,
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: String(incoming.headers.authorization || ""),
          },
          body: rawBody,
          signal: controller.signal,
        });
        const result = await chatRoute.POST(request);
        if (outgoing.destroyed) return;
        outgoing.writeHead(result.status, Object.fromEntries(result.headers));
        outgoing.end(await result.text());
      } catch (error) {
        if (outgoing.destroyed) return;
        outgoing.writeHead(500, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: String(error) }));
      } finally {
        applicationFinished.resolve();
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const originalRequest = http.request;
  const forwardingTimeouts: number[] = [];
  // AICODE-NOTE: Scale only the former native bridge forwarding window, never
  // backend target timers. The upstream-configured forwarding timeout (0) is untouched.
  http.request = ((options, ...args) => {
    if (typeof options === "object" && Number(options.port) === address.port) {
      forwardingTimeouts.push(options.timeout);
      options = {
        ...options,
        timeout: scaleOldWindow && options.timeout === 600000 ? 250 : options.timeout,
      };
    }
    return Reflect.apply(originalRequest, http, [options, ...args]);
  }) as typeof http.request;
  const gateway = viaBridge ? bridgeModule.createApiBridgeServer(address.port) : null;
  if (gateway) {
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");
  }
  const publicAddress = gateway?.address() || address;
  assert.ok(typeof publicAddress === "object");
  return {
    url: `http://127.0.0.1:${publicAddress.port}/v1/chat/completions`,
    clientSignals,
    responses,
    rawBodies,
    incomingHeaders,
    forwardingTimeouts,
    applicationFinished: applicationFinished.promise,
    close: async () => {
      http.request = originalRequest;
      for (const listener of [gateway, server]) {
        if (!listener) continue;
        listener.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          listener.close((error) => (error ? reject(error) : resolve()))
        );
      }
    },
  };
}

function completionRequest(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${callerApiKey}` },
    body: requestBody,
    signal,
  });
}

function assertUpstreamRequest(init: RequestInit): void {
  const body = JSON.parse(String(init.body));
  assert.equal(body.max_tokens, 64);
  assert.equal(body.stream, false);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].function.name, "lookup_status");
}

function abortError(): Error {
  return new Error("mock upstream aborted by target timeout");
}

test.beforeEach(async () => {
  await resetStorage();
  await seedFreeBand();
  callerApiKey = (await harness.seedApiKey()).key;
});

test.afterEach(async () => {
  delete process.env.OMNIROUTE_AUTO_BANDS;
  BaseExecutor.RETRY_CONFIG.delayMs = harness.originalRetryDelayMs;
  await resetStorage();
});

test.after(async () => {
  await harness.cleanup();
  for (const [index, name] of deadlineEnvNames.entries()) {
    const original = originalDeadlineEnv[index];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

for (const viaBridge of [false, true]) {
  const boundary = viaBridge ? "API bridge HTTP" : "HTTP";
  test(`${boundary} caller stays connected through Auto freeband target timeout and receives next success`, async () => {
    const adapter = await startHttpAdapter(viaBridge);
    const secondStarted = deferred<void>();
    const releaseSecond = deferred<void>();
    const seenModels: string[] = [];
    const originalFetch = globalThis.fetch;
    let callerSettled = false;
    try {
      globalThis.fetch = async (_url: RequestInfo | URL, init: RequestInit = {}) => {
        const model = JSON.parse(String(init.body)).model;
        seenModels.push(model);
        if (seenModels.length === 2) secondStarted.resolve();
        assertUpstreamRequest(init);
        if (seenModels.length === 1) {
          const signal = init.signal as AbortSignal;
          return new Promise<Response>((_resolve, reject) => {
            const onAbort = () => reject(abortError());
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          });
        }
        await releaseSecond.promise;
        return new Response(
          JSON.stringify({
            id: "chatcmpl-ind004",
            choices: [{ message: { role: "assistant", content: "HTTP fallback body" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      };

      const caller = completionRequest(adapter.url, originalFetch).finally(() => {
        callerSettled = true;
      });
      await within(secondStarted.promise);
      assert.equal(
        callerSettled,
        false,
        "no HTTP response may settle before the next target completes"
      );
      assert.equal(
        adapter.clientSignals[0]?.aborted,
        false,
        "target timeout must not abort caller signal"
      );
      assert.equal(
        adapter.responses[0]?.headersSent,
        false,
        "route must not flush a premature error"
      );

      releaseSecond.resolve();
      const response = await caller;
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.id, "chatcmpl-ind004");
      assert.deepEqual(body.choices[0].message, {
        role: "assistant",
        content: "HTTP fallback body",
      });
      assert.deepEqual(new Set(seenModels), new Set(candidates));
      assert.equal(seenModels.length, 2);
      assert.equal(adapter.clientSignals[0]?.aborted, false);
      if (viaBridge) {
        assert.deepEqual(adapter.forwardingTimeouts, [0]);
        assert.deepEqual(adapter.rawBodies, [Buffer.from(requestBody)]);
        assert.equal(adapter.incomingHeaders[0].authorization, `Bearer ${callerApiKey}`);
      }
    } finally {
      releaseSecond.resolve();
      globalThis.fetch = originalFetch;
      await adapter.close();
    }
  });

  test(`${boundary} caller receives aggregate after both distinct Auto freeband targets time out`, async () => {
    const adapter = await startHttpAdapter(viaBridge);
    const seenModels: string[] = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (_url: RequestInfo | URL, init: RequestInit = {}) => {
        const model = JSON.parse(String(init.body)).model;
        seenModels.push(model);
        assertUpstreamRequest(init);
        const signal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          const onAbort = () => reject(abortError());
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
      };

      const response = await completionRequest(adapter.url, originalFetch);
      const body = await response.text();
      assert.equal(response.status, 504);
      assert.equal(seenModels.length, 2);
      assert.deepEqual(new Set(seenModels), new Set(candidates));
      for (const model of candidates)
        assert.ok(body.includes(model), `aggregate missing ${model}: ${body}`);
      assert.ok(body.includes("combo_target_timeout"), `aggregate missing timeout reason: ${body}`);
      assert.equal(adapter.clientSignals[0]?.aborted, false);
      if (viaBridge) {
        assert.deepEqual(adapter.forwardingTimeouts, [0]);
        assert.deepEqual(adapter.rawBodies, [Buffer.from(requestBody)]);
        assert.equal(adapter.incomingHeaders[0].authorization, `Bearer ${callerApiKey}`);
      }
    } finally {
      globalThis.fetch = originalFetch;
      await adapter.close();
    }
  });
}

for (const [name, env] of Object.entries({
  REQUEST_TIMEOUT_MS: { REQUEST_TIMEOUT_MS: "100", API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS: "100" },
  API_BRIDGE_PROXY_TIMEOUT_MS: {
    API_BRIDGE_PROXY_TIMEOUT_MS: "100",
    API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS: "100",
  },
  API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS: {
    REQUEST_TIMEOUT_MS: "0",
    API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS: "100",
  },
})) {
  test(`API bridge honors explicit ${name}`, async () => {
    Object.assign(process.env, env);
    let explicitBridge: typeof apiBridge;
    try {
      explicitBridge = await import(`../../src/lib/apiBridgeServer.ts?ind004=${name}`);
    } finally {
      for (const deadlineName of deadlineEnvNames) delete process.env[deadlineName];
    }
    const adapter = await startHttpAdapter(true, explicitBridge, false);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init: RequestInit = {}) => {
      assertUpstreamRequest(init);
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) reject(abortError());
        else signal.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    };
    try {
      const response = await completionRequest(adapter.url, originalFetch);
      assert.equal(response.status, 504);
      assert.deepEqual(await response.json(), {
        error: "api_bridge_timeout",
        detail: "Proxy request timed out after 100ms",
      });
      assert.deepEqual(adapter.forwardingTimeouts, [100]);
    } finally {
      globalThis.fetch = originalFetch;
      await adapter.close();
      await within(adapter.applicationFinished);
    }
  });
}

for (const explicit of [false, true]) {
  test(`API bridge operation classification preserves ${explicit ? "explicit server-request max" : "implicit query deadlines"}`, async () => {
    for (const name of deadlineEnvNames) delete process.env[name];
    let bridgeModule = await import("../../src/lib/apiBridgeServer.ts?native-defaults");
    if (explicit) {
      process.env.API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS = "900000";
      try {
        bridgeModule = await import("../../src/lib/apiBridgeServer.ts?ind004=operation-explicit");
      } finally {
        delete process.env.API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS;
      }
    }
    const dashboard = http.createServer((_req, res) => res.end("ok"));
    dashboard.listen(0, "127.0.0.1");
    await once(dashboard, "listening");
    const dashboardPort = (dashboard.address() as import("node:net").AddressInfo).port;
    const gateway = bridgeModule.createApiBridgeServer(dashboardPort);
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");
    const port = (gateway.address() as import("node:net").AddressInfo).port;
    const originalRequest = http.request;
    const timeouts: number[] = [];
    http.request = ((options, ...args) => {
      if (typeof options === "object" && Number(options.port) === dashboardPort)
        timeouts.push(options.timeout);
      return Reflect.apply(originalRequest, http, [options, ...args]);
    }) as typeof http.request;
    // Method, admitted path, Accept, implicit timeout, explicit legacy timeout.
    const cases = [
      ["GET", "/v1/models", "application/json", 600000, 600000],
      ["GET", "/v1/models", "text/event-stream", 600000, 900000],
      ["POST", "/v1/models", "text/event-stream", 600000, 900000],
      ["POST", "/v1/chat/completions", "application/json", 600000, 900000],
      ["POST", "/chat/completions", "application/json", 600000, 900000],
      ["POST", "/v1/responses/?trace=1", "application/json", 600000, 900000],
      ["POST", "/responses", "application/json", 600000, 900000],
      ["POST", "/v1/messages", "application/json", 600000, 600000],
      ["POST", "/v1/messages/?trace=1", "text/event-stream", 600000, 900000],
      ["GET", "/v1/messages", "application/json", 600000, 600000],
      ["GET", "/v1/responses", "application/json", 600000, 900000],
      ["GET", "/v1/chat/completions", "application/json", 600000, 900000],
      ["POST", "/v1/messages/count_tokens", "application/json", 600000, 600000],
      ["POST", "/v1/messages/count_tokens", "text/event-stream", 600000, 900000],
      ["POST", "/v1/responses/response-id/cancel", "application/json", 600000, 900000],
      ["POST", "/v1/chat/completions/resource", "application/json", 600000, 900000],
    ] as const;
    try {
      for (const [method, path, accept, implicit, configured] of cases) {
        const response = await globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { accept },
        });
        assert.equal(await response.text(), "ok");
        assert.equal(
          timeouts.at(-1),
          explicit ? configured : implicit,
          `${method} ${path} Accept:${accept}`
        );
      }
      assert.equal(timeouts.length, cases.length);
    } finally {
      http.request = originalRequest;
      for (const server of [gateway, dashboard]) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });
}
