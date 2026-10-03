import assert from "node:assert/strict";
import test from "node:test";

import {
  loadSystemOneConfig,
  type SystemOneUpstreamName,
} from "../../open-sse/services/systemOne/config.ts";
import {
  dispatchSystemOneRequest,
  type SystemOneCooldownEntry,
} from "../../open-sse/services/systemOne/dispatch.ts";
import type { SystemOneRequest } from "../../open-sse/services/systemOne/schema.ts";

const DEFAULT_BODY: SystemOneRequest = {
  state: "Choose a team",
  questions: {
    team: {
      type: "choice",
      instructions: "Choose one",
      criteria: { billing: "Billing", technical: "Technical" },
    },
  },
};

function configFor(overrides: Record<string, string | undefined> = {}) {
  return loadSystemOneConfig({
    OMNIROUTE_SYSTEMONE_LAYA_URL: "https://laya.example/",
    OMNIROUTE_SYSTEMONE_TYPESAFE_API_KEY: "typesafe-key",
    OMNIROUTE_SYSTEMONE_OPENROUTER_API_KEY: "openrouter-key",
    ...overrides,
  });
}

function response(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  });
}

function successBody(model = "jev-1.13.0") {
  return {
    model,
    answers: { team: { choice: "technical", confidence: 0.8 } },
    usage: { input_tokens: 20, output_tokens: 3 },
  };
}

type FetchCall = { url: string; init: RequestInit; body: Record<string, unknown> };

function captureFetch(handler: (call: FetchCall, index: number) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const call = { url, init, body };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { calls, fetchImpl };
}

test("configuration uses only configured upstreams, stable order, and documented defaults", () => {
  const config = configFor({
    OMNIROUTE_SYSTEMONE: "TRUE",
    OMNIROUTE_SYSTEMONE_ORDER: "typesafe,unknown,laya,typesafe",
    OMNIROUTE_SYSTEMONE_LAYA_MODEL: "multilingual",
    OMNIROUTE_SYSTEMONE_TIMEOUT_MS: "7000",
    OMNIROUTE_SYSTEMONE_COOLDOWN_MS: "60000",
  });

  assert.equal(config.enabled, true);
  assert.deepEqual(config.order, ["typesafe", "laya"]);
  assert.equal(config.upstreams.laya?.url, "https://laya.example/v1/systemone");
  assert.equal(config.upstreams.laya?.model, "multilingual");
  assert.equal(config.upstreams.laya?.apiKey, undefined);
  assert.equal(config.upstreams.typesafe?.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(config.upstreams.typesafe?.model, "jev-latest");
  assert.equal(config.upstreams.openrouter?.url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(config.upstreams.openrouter?.model, "typesafe/jev-1.13");
  assert.equal(config.timeoutMs, 7000);
  assert.equal(config.cooldownMs, 60000);
  assert.equal(loadSystemOneConfig({}).enabled, false);
  assert.equal(loadSystemOneConfig({ OMNIROUTE_SYSTEMONE: "yes" }).enabled, false);
});

test("chain configuration excludes providers without required environment values", () => {
  const config = loadSystemOneConfig({
    OMNIROUTE_SYSTEMONE_LAYA_URL: "https://laya.example",
    OMNIROUTE_SYSTEMONE_ORDER: "openrouter,typesafe,laya",
  });

  assert.deepEqual(config.order, ["laya"]);
  assert.equal(config.upstreams.typesafe, null);
  assert.equal(config.upstreams.openrouter, null);
});

test("dispatch sends only the normalized request fields and upstream-specific model/auth", async () => {
  const cases = [
    {
      model: "laya/multilingual",
      env: {
        OMNIROUTE_SYSTEMONE_LAYA_MODEL: undefined,
        OMNIROUTE_SYSTEMONE_LAYA_API_KEY: undefined,
      },
      expectedUrl: "https://laya.example/v1/systemone",
      expectedModel: "multilingual",
      expectedAuthorization: null,
    },
    {
      model: "typesafe/jev-1.12",
      env: {},
      expectedUrl: "https://api.typesafe.ai/v1/systemone",
      expectedModel: "jev-1.12",
      expectedAuthorization: "Bearer typesafe-key",
    },
    {
      model: "openrouter/typesafe/jev-1.13",
      env: {},
      expectedUrl: "https://openrouter.ai/api/alpha/decisions",
      expectedModel: "typesafe/jev-1.13",
      expectedAuthorization: "Bearer openrouter-key",
    },
  ] as const;

  for (const scenario of cases) {
    const { calls, fetchImpl } = captureFetch(() => response(200, successBody()));
    const config = configFor({
      OMNIROUTE_SYSTEMONE_ORDER: scenario.model.startsWith("laya/")
        ? "laya"
        : scenario.model.startsWith("typesafe/")
          ? "typesafe"
          : "openrouter",
      ...scenario.env,
    });

    const result = await dispatchSystemOneRequest(
      { ...DEFAULT_BODY, model: scenario.model },
      config,
      { fetchImpl, now: () => 1000, cooldowns: new Map() }
    );

    assert.equal(result.ok, true, scenario.model);
    assert.equal(calls.length, 1, scenario.model);
    assert.equal(calls[0]?.url, scenario.expectedUrl);
    assert.equal(calls[0]?.body.state, DEFAULT_BODY.state);
    assert.deepEqual(calls[0]?.body.questions, DEFAULT_BODY.questions);
    assert.deepEqual(
      Object.keys(calls[0]?.body ?? {}).sort(),
      ["model", "questions", "state"].filter(
        (key) => key !== "model" || scenario.expectedModel !== undefined
      )
    );
    assert.equal(calls[0]?.body.model, scenario.expectedModel);
    assert.equal(
      new Headers(calls[0]?.init.headers).get("authorization"),
      scenario.expectedAuthorization
    );
  }
});

test("Jev model uses chain and is rewritten only where required", async () => {
  const { calls, fetchImpl } = captureFetch((call) => {
    if (call.url.startsWith("https://laya"))
      return response(422, { error: { message: "unsupported model" } });
    return response(200, successBody());
  });

  const result = await dispatchSystemOneRequest(
    { ...DEFAULT_BODY, model: "jev-1.13.0" },
    configFor(),
    { fetchImpl, now: () => 1000, cooldowns: new Map() }
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal("model" in (calls[0]?.body ?? {}), false);
  assert.equal(calls[1]?.body.model, "jev-1.13.0");
});

test("retryable failures fall through and enter cooldown", async (context) => {
  const retryableStatuses = [500, 503, 429, 401, 403];
  for (const status of retryableStatuses) {
    await context.test(`Laya ${status}`, async () => {
      const cooldowns = new Map<SystemOneUpstreamName, SystemOneCooldownEntry>();
      const { calls, fetchImpl } = captureFetch((call) =>
        call.url.startsWith("https://laya")
          ? response(status, { error: { message: `Laya returned ${status}` } })
          : response(200, successBody())
      );

      const result = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
        fetchImpl,
        now: () => 1000,
        cooldowns,
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 2);
      assert.equal(cooldowns.get("laya")?.expiresAtMs, 31000);
    });
  }
});

test("429 honors Retry-After but caps cooldown at four times its base", async () => {
  const cooldowns = new Map<SystemOneUpstreamName, SystemOneCooldownEntry>();
  const { fetchImpl } = captureFetch((call) =>
    call.url.startsWith("https://laya")
      ? response(429, { error: { message: "busy" } }, { "retry-after": "999" })
      : response(200, successBody())
  );

  const result = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
    fetchImpl,
    now: () => 1000,
    cooldowns,
  });

  assert.equal(result.ok, true);
  assert.equal(cooldowns.get("laya")?.expiresAtMs, 121000);
});

test("Laya 413 and 422 fall through without cooldown; a Jev 400 stops the chain", async (context) => {
  for (const status of [413, 422]) {
    await context.test(`Laya ${status}`, async () => {
      const cooldowns = new Map<SystemOneUpstreamName, SystemOneCooldownEntry>();
      const { calls, fetchImpl } = captureFetch((call) =>
        call.url.startsWith("https://laya")
          ? response(status, { error: { message: "state too large" } })
          : response(200, successBody())
      );
      const result = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
        fetchImpl,
        now: () => 1000,
        cooldowns,
      });
      assert.equal(result.ok, true);
      assert.equal(calls.length, 2);
      assert.equal(cooldowns.has("laya"), false);
    });
  }

  const { calls, fetchImpl } = captureFetch((call) =>
    call.url.startsWith("https://laya")
      ? response(422, { error: { message: "too large" } })
      : response(400, { error: { message: "bad request" } })
  );
  const rejected = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
    fetchImpl,
    now: () => 1000,
    cooldowns: new Map(),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 400);
  assert.equal(calls.length, 2);
});

test("transport failure and timeout fall through; pinned failures return gateway status", async (context) => {
  await context.test("network failure falls through", async () => {
    const { calls, fetchImpl } = captureFetch((call) => {
      if (call.url.startsWith("https://laya")) throw new TypeError("connection refused");
      return response(200, successBody());
    });
    const cooldowns = new Map<SystemOneUpstreamName, SystemOneCooldownEntry>();
    const result = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
      fetchImpl,
      now: () => 1000,
      cooldowns,
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(cooldowns.get("laya")?.expiresAtMs, 31000);
  });

  await context.test("timeout falls through", async () => {
    const config = configFor({ OMNIROUTE_SYSTEMONE_TIMEOUT_MS: "5" });
    const { calls, fetchImpl } = captureFetch((call) => {
      if (!call.url.startsWith("https://laya")) return response(200, successBody());
      return new Promise<Response>((_resolve, reject) => {
        call.init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          {
            once: true,
          }
        );
      });
    });
    const cooldowns = new Map<SystemOneUpstreamName, SystemOneCooldownEntry>();
    const result = await dispatchSystemOneRequest(DEFAULT_BODY, config, {
      fetchImpl,
      now: () => 1000,
      cooldowns,
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(cooldowns.get("laya")?.expiresAtMs, 31000);
  });

  await context.test("pinned network failure maps to 502", async () => {
    const { calls, fetchImpl } = captureFetch(() => {
      throw new TypeError("connection refused");
    });
    const result = await dispatchSystemOneRequest({ ...DEFAULT_BODY, model: "laya" }, configFor(), {
      fetchImpl,
      now: () => 1000,
      cooldowns: new Map(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.equal(calls.length, 1);
  });
});

test("pinned HTTP error keeps its status; invalid error body becomes a short cause", async () => {
  const { calls, fetchImpl } = captureFetch(() => new Response("not json", { status: 418 }));
  const result = await dispatchSystemOneRequest(
    { ...DEFAULT_BODY, model: "typesafe/jev-latest" },
    configFor(),
    { fetchImpl, now: () => 1000, cooldowns: new Map() }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 418);
  assert.match(result.errorMessage, /unreadable.*error body/i);
  assert.equal(calls.length, 1);
});

test("cooldown skips a failed upstream and forces earliest expiry when all are cooling", async (context) => {
  await context.test("skip active cooldown", async () => {
    const { calls, fetchImpl } = captureFetch(() => response(200, successBody()));
    const result = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
      fetchImpl,
      now: () => 10000,
      cooldowns: new Map<SystemOneUpstreamName, SystemOneCooldownEntry>([
        ["laya", { expiresAtMs: 20000 }],
      ]),
    });
    assert.equal(result.ok, true);
    assert.equal(calls[0]?.url, "https://api.typesafe.ai/v1/systemone");
  });

  await context.test("force provider whose cooldown ends first", async () => {
    const { calls, fetchImpl } = captureFetch(() => response(200, successBody()));
    const result = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
      fetchImpl,
      now: () => 10000,
      cooldowns: new Map<SystemOneUpstreamName, SystemOneCooldownEntry>([
        ["laya", { expiresAtMs: 30000 }],
        ["typesafe", { expiresAtMs: 20000 }],
        ["openrouter", { expiresAtMs: 25000 }],
      ]),
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://api.typesafe.ai/v1/systemone");
  });
});

test("late success does not clear a cooldown written by a newer concurrent failure", async () => {
  let resolveFirstLaya!: (value: Response) => void;
  let signalFirstLayaStarted!: () => void;
  const firstLayaStarted = new Promise<void>((resolve) => {
    signalFirstLayaStarted = resolve;
  });
  const firstLayaResponse = new Promise<Response>((resolve) => {
    resolveFirstLaya = resolve;
  });
  let layaCallCount = 0;
  const cooldowns = new Map<SystemOneUpstreamName, SystemOneCooldownEntry>();
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.startsWith("https://laya")) {
      layaCallCount += 1;
      if (layaCallCount === 1) {
        signalFirstLayaStarted();
        return firstLayaResponse;
      }
      return response(429, { error: { message: "Laya busy" } });
    }

    return response(200, successBody());
  };

  const firstRequest = dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
    fetchImpl,
    now: () => 1000,
    cooldowns,
  });
  await firstLayaStarted;

  const secondResult = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
    fetchImpl,
    now: () => 1000,
    cooldowns,
  });
  assert.equal(secondResult.ok, true);
  assert.equal(cooldowns.get("laya")?.expiresAtMs, 31000);

  resolveFirstLaya(response(200, successBody()));
  const firstResult = await firstRequest;
  assert.equal(firstResult.ok, true);
  assert.equal(cooldowns.get("laya")?.expiresAtMs, 31000);

  const thirdResult = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
    fetchImpl,
    now: () => 1000,
    cooldowns,
  });
  assert.equal(thirdResult.ok, true);
  assert.equal(thirdResult.attempts[0]?.upstream, "typesafe");
  assert.equal(layaCallCount, 2);
});

test("chain exhaustion returns 502 with last upstream status and sanitized cause", async () => {
  const { fetchImpl } = captureFetch((call) =>
    call.url.includes("typesafe.ai")
      ? response(503, { error: { message: "TypeSafe is overloaded" } })
      : response(500, { error: { message: "Upstream unavailable" } })
  );

  const result = await dispatchSystemOneRequest(DEFAULT_BODY, configFor(), {
    fetchImpl,
    now: () => 1000,
    cooldowns: new Map(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.upstreamStatus, 500);
  assert.equal(result.errorMessage, "Upstream unavailable");
});

test("response normalization fills Laya model, question types, and usage while preserving extras", async () => {
  const { fetchImpl } = captureFetch(() =>
    response(200, {
      routing: { model: "multilingual", other: "kept" },
      answers: { team: { choice: "technical" } },
      extra: { kept: true },
    })
  );
  const result = await dispatchSystemOneRequest({ ...DEFAULT_BODY, model: "laya" }, configFor(), {
    fetchImpl,
    now: () => 1000,
    cooldowns: new Map(),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.body.model, "laya/multilingual");
    assert.equal(result.body.answers.team.type, "choice");
    assert.deepEqual(result.body.usage, { input_tokens: 0, output_tokens: 0 });
    assert.deepEqual(result.body.routing, { model: "multilingual", other: "kept" });
    assert.deepEqual(result.body.extra, { kept: true });
  }
});

test("OpenRouter response fields including cost pass through unchanged", async () => {
  const { fetchImpl } = captureFetch(() =>
    response(200, {
      model: "typesafe/jev-1.13",
      id: "decision-1",
      provider: "provider-a",
      answers: { team: { type: "choice", choice: "technical" } },
      usage: { input_tokens: 12, output_tokens: 2, cost: 0.002 },
    })
  );
  const result = await dispatchSystemOneRequest(
    { ...DEFAULT_BODY, model: "openrouter/typesafe/jev-1.13" },
    configFor(),
    { fetchImpl, now: () => 1000, cooldowns: new Map() }
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.body.id, "decision-1");
    assert.equal(result.body.provider, "provider-a");
    assert.deepEqual(result.body.usage, { input_tokens: 12, output_tokens: 2, cost: 0.002 });
  }
});
