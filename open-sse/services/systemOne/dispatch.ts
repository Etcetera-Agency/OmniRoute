import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";

import {
  SYSTEMONE_REQUIRED_VARIABLES,
  type SystemOneConfig,
  type SystemOneUpstreamConfig,
  type SystemOneUpstreamName,
} from "./config.ts";
import {
  parseSystemOneModelSelection,
  SYSTEMONE_ACCEPTED_MODEL_FORMS,
  type SystemOneModelSelection,
  type SystemOneRequest,
} from "./schema.ts";

export interface SystemOneAttemptPlan {
  upstream: SystemOneUpstreamConfig;
  sentModel?: string;
  logModel: string;
}

export type SystemOneDispatchPlan =
  | {
      ok: true;
      mode: "chain" | "pinned";
      attempts: SystemOneAttemptPlan[];
    }
  | { ok: false; status: 400 | 503; message: string };

export interface SystemOneAttempt {
  upstream: SystemOneUpstreamName;
  status: number;
  model: string;
  durationMs: number;
  connectionId: string;
  usage: Record<string, unknown> | null;
  errorMessage?: string;
}

interface SystemOneDispatchBase {
  attempts: SystemOneAttempt[];
  latencyMs: number;
}

export type SystemOneDispatchResult =
  | (SystemOneDispatchBase & {
      ok: true;
      status: number;
      body: Record<string, unknown>;
      provider: SystemOneUpstreamName;
      model: string;
      usage: Record<string, unknown>;
      costUsd: unknown;
    })
  | (SystemOneDispatchBase & {
      ok: false;
      status: number;
      errorMessage: string;
      upstreamStatus: number | null;
      provider: SystemOneUpstreamName;
      model: string;
    });

export interface SystemOneDispatchDependencies {
  fetchImpl?: typeof fetch;
  now?: () => number;
  cooldowns?: Map<SystemOneUpstreamName, SystemOneCooldownEntry>;
}

export interface SystemOneCooldownEntry {
  expiresAtMs: number;
}

const activeCooldowns = new Map<SystemOneUpstreamName, SystemOneCooldownEntry>();
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeCause(value: unknown, fallback: string): string {
  const sanitized = sanitizeErrorMessage(value).replace(/\s+/g, " ").trim().slice(0, 240);
  return sanitized || fallback;
}

function getHttpErrorMessage(value: unknown, status: number): string {
  let candidate: unknown;
  if (typeof value === "string") {
    candidate = value;
  } else if (isRecord(value)) {
    const error = value.error;
    if (typeof error === "string") candidate = error;
    else if (isRecord(error)) candidate = error.message ?? error.detail;
    candidate ??= value.message ?? value.detail ?? value.error_description;
  }

  if (typeof candidate !== "string" || !candidate.trim()) {
    return `Upstream returned HTTP ${status}`;
  }
  return sanitizeCause(candidate, `Upstream returned HTTP ${status}`);
}

function elapsedSince(startedAt: number, now: () => number): number {
  return Math.max(0, now() - startedAt);
}

function pickSentModel(
  upstream: SystemOneUpstreamConfig,
  selection: SystemOneModelSelection
): string | undefined {
  if (selection.kind === "pinned" && selection.upstream === upstream.name && selection.model) {
    return selection.model;
  }
  if (upstream.name === "typesafe" && selection.kind === "chain" && selection.jevModel) {
    return selection.jevModel;
  }
  return upstream.model;
}

function buildAttemptPlan(
  upstream: SystemOneUpstreamConfig,
  selection: SystemOneModelSelection,
  requestedModel: string | undefined
): SystemOneAttemptPlan {
  const sentModel = pickSentModel(upstream, selection);
  return {
    upstream,
    sentModel,
    logModel:
      requestedModel === undefined || sentModel === undefined
        ? `${upstream.name}/default`
        : `${upstream.name}/${sentModel}`,
  };
}

function getMissingConfigurationMessage(config: SystemOneConfig, anyConfigured: boolean): string {
  if (anyConfigured) {
    return "OMNIROUTE_SYSTEMONE_ORDER does not select a configured SystemOne upstream";
  }

  const missing = (Object.keys(config.upstreams) as SystemOneUpstreamName[])
    .filter((name) => config.upstreams[name] === null)
    .map((name) => SYSTEMONE_REQUIRED_VARIABLES[name]);
  return `Configure at least one SystemOne upstream with: ${missing.join(", ")}`;
}

export function planSystemOneDispatch(
  config: SystemOneConfig,
  requestedModel: string | undefined
): SystemOneDispatchPlan {
  const selection = parseSystemOneModelSelection(requestedModel);
  if (selection.kind === "invalid") {
    return {
      ok: false,
      status: 400,
      message: `Invalid SystemOne model. Accepted forms: ${SYSTEMONE_ACCEPTED_MODEL_FORMS}`,
    };
  }

  if (selection.kind === "pinned") {
    const upstream = config.upstreams[selection.upstream];
    if (!upstream) {
      return {
        ok: false,
        status: 400,
        message: `SystemOne upstream "${selection.upstream}" is not configured. Accepted forms: ${SYSTEMONE_ACCEPTED_MODEL_FORMS}`,
      };
    }
    return {
      ok: true,
      mode: "pinned",
      attempts: [buildAttemptPlan(upstream, selection, requestedModel)],
    };
  }

  const attempts = config.order.flatMap((name) => {
    const upstream = config.upstreams[name];
    return upstream ? [buildAttemptPlan(upstream, selection, requestedModel)] : [];
  });
  if (attempts.length === 0) {
    const anyConfigured = Object.values(config.upstreams).some((upstream) => upstream !== null);
    return {
      ok: false,
      status: 503,
      message: getMissingConfigurationMessage(config, anyConfigured),
    };
  }
  return { ok: true, mode: "chain", attempts };
}

function getResponseUsage(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.usage)) return null;
  return value.usage;
}

function normalizeCounter(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) return numericValue;
  }
  return 0;
}

function normalizeSystemOneResponse(
  responseBody: Record<string, unknown>,
  requestBody: SystemOneRequest,
  plan: SystemOneAttemptPlan
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...responseBody };
  const routing = isRecord(responseBody.routing) ? responseBody.routing : null;
  const routingModel =
    typeof routing?.model === "string" && routing.model.trim() ? routing.model : null;
  let fallbackModel = `${plan.upstream.name}/${plan.sentModel ?? "default"}`;
  if (plan.upstream.name === "laya") {
    fallbackModel = routingModel ? `laya/${routingModel}` : "laya";
  }
  normalized.model =
    typeof responseBody.model === "string" && responseBody.model.trim()
      ? responseBody.model
      : fallbackModel;

  const responseAnswers = isRecord(responseBody.answers) ? responseBody.answers : {};
  const answers: Record<string, unknown> = { ...responseAnswers };
  for (const [name, answer] of Object.entries(responseAnswers)) {
    const question = requestBody.questions[name];
    if (!isRecord(answer) || !question || typeof answer.type === "string") continue;
    answers[name] = { ...answer, type: question.type };
  }
  normalized.answers = answers;

  const responseUsage = isRecord(responseBody.usage) ? responseBody.usage : {};
  normalized.usage = {
    ...responseUsage,
    input_tokens: normalizeCounter(responseUsage.input_tokens),
    output_tokens: normalizeCounter(responseUsage.output_tokens),
  };
  return normalized;
}

function getRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    const seconds = Number(normalized);
    return seconds >= 0 ? seconds * 1000 : null;
  }
  const dateMs = Date.parse(normalized);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

function getInitialAttemptOrder(
  attempts: SystemOneAttemptPlan[],
  cooldowns: Map<SystemOneUpstreamName, SystemOneCooldownEntry>,
  nowMs: number
): SystemOneAttemptPlan[] {
  const ready = attempts.filter(
    (attempt) => (cooldowns.get(attempt.upstream.name)?.expiresAtMs ?? 0) <= nowMs
  );
  if (ready.length > 0) return ready;

  const earliest = attempts.reduce((winner, candidate) =>
    (cooldowns.get(candidate.upstream.name)?.expiresAtMs ?? 0) <
    (cooldowns.get(winner.upstream.name)?.expiresAtMs ?? 0)
      ? candidate
      : winner
  );
  return [earliest];
}

function buildUpstreamRequestBody(
  body: SystemOneRequest,
  plan: SystemOneAttemptPlan
): Record<string, unknown> {
  return {
    state: body.state,
    questions: body.questions,
    ...(plan.sentModel !== undefined ? { model: plan.sentModel } : {}),
  };
}

async function performUpstreamAttempt(
  body: SystemOneRequest,
  plan: SystemOneAttemptPlan,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<
  | { kind: "http"; response: Response; body: unknown; readable: boolean }
  | { kind: "transport"; message: string }
> {
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const request = async () => {
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
    });
    if (plan.upstream.apiKey) headers.set("authorization", `Bearer ${plan.upstream.apiKey}`);

    const response = await fetchImpl(plan.upstream.url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildUpstreamRequestBody(body, plan)),
      signal: controller.signal,
    });
    try {
      return { kind: "http" as const, response, body: await response.json(), readable: true };
    } catch {
      return { kind: "http" as const, response, body: null, readable: false };
    }
  };

  const timedOutRequest = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("SystemOne upstream timeout"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([request(), timedOutRequest]);
  } catch (error) {
    const message = timedOut
      ? "Upstream request timed out"
      : sanitizeCause(error, "Upstream request failed");
    return { kind: "transport", message };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildFailure(
  status: number,
  upstreamStatus: number | null,
  message: string,
  attempt: SystemOneAttempt,
  attempts: SystemOneAttempt[],
  latencyMs: number
): SystemOneDispatchResult {
  return {
    ok: false,
    status,
    upstreamStatus,
    errorMessage: message,
    provider: attempt.upstream,
    model: attempt.model,
    attempts,
    latencyMs,
  };
}

function isRetryableStatus(upstream: SystemOneUpstreamName, status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    status >= 500 ||
    (upstream === "laya" && (status === 413 || status === 422))
  );
}

export async function dispatchSystemOneRequest(
  body: SystemOneRequest,
  config: SystemOneConfig,
  dependencies: SystemOneDispatchDependencies = {}
): Promise<SystemOneDispatchResult> {
  const now = dependencies.now ?? Date.now;
  const cooldowns = dependencies.cooldowns ?? activeCooldowns;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const requestedModel = body.model;
  const plan = planSystemOneDispatch(config, requestedModel);
  if (plan.ok === false) {
    return {
      ok: false,
      status: plan.status,
      upstreamStatus: null,
      errorMessage: plan.message,
      provider: "laya",
      model: "laya/default",
      attempts: [],
      latencyMs: 0,
    };
  }

  const startedAt = now();
  const attemptPlans =
    plan.mode === "pinned"
      ? plan.attempts
      : getInitialAttemptOrder(plan.attempts, cooldowns, startedAt);
  const attempts: SystemOneAttempt[] = [];
  let lastFailure: { status: number; upstreamStatus: number | null; message: string } | null = null;

  for (const attemptPlan of attemptPlans) {
    const attemptStartedAt = now();
    const cooldownAtStart = cooldowns.get(attemptPlan.upstream.name);
    const upstreamResult = await performUpstreamAttempt(
      body,
      attemptPlan,
      config.timeoutMs,
      fetchImpl
    );
    const durationMs = elapsedSince(attemptStartedAt, now);

    if (upstreamResult.kind === "transport") {
      const attempt: SystemOneAttempt = {
        upstream: attemptPlan.upstream.name,
        status: 502,
        model: attemptPlan.logModel,
        durationMs,
        connectionId: attemptPlan.upstream.connectionId,
        usage: null,
        errorMessage: upstreamResult.message,
      };
      attempts.push(attempt);
      lastFailure = { status: 502, upstreamStatus: null, message: upstreamResult.message };
      if (plan.mode === "pinned") {
        return buildFailure(
          502,
          null,
          upstreamResult.message,
          attempt,
          attempts,
          elapsedSince(startedAt, now)
        );
      }
      cooldowns.set(attemptPlan.upstream.name, { expiresAtMs: now() + config.cooldownMs });
      continue;
    }

    const status = upstreamResult.response.status;
    const responseUsage = getResponseUsage(upstreamResult.body);
    if (upstreamResult.response.ok) {
      if (upstreamResult.readable && isRecord(upstreamResult.body)) {
        const normalizedBody = normalizeSystemOneResponse(upstreamResult.body, body, attemptPlan);
        const usage = normalizedBody.usage as Record<string, unknown>;
        const attempt: SystemOneAttempt = {
          upstream: attemptPlan.upstream.name,
          status,
          model: attemptPlan.logModel,
          durationMs,
          connectionId: attemptPlan.upstream.connectionId,
          usage,
        };
        attempts.push(attempt);
        // AICODE-NOTE: Entry identity keeps late successes from clearing cooldowns refreshed by concurrent requests.
        if (cooldowns.get(attemptPlan.upstream.name) === cooldownAtStart) {
          cooldowns.delete(attemptPlan.upstream.name);
        }
        return {
          ok: true,
          status,
          body: normalizedBody,
          provider: attemptPlan.upstream.name,
          model: String(normalizedBody.model),
          usage,
          costUsd: usage.cost ?? 0,
          attempts,
          latencyMs: elapsedSince(startedAt, now),
        };
      }

      const message = upstreamResult.readable
        ? `Invalid upstream response body (HTTP ${status})`
        : `Unreadable upstream response body (HTTP ${status})`;
      const attempt: SystemOneAttempt = {
        upstream: attemptPlan.upstream.name,
        status: 502,
        model: attemptPlan.logModel,
        durationMs,
        connectionId: attemptPlan.upstream.connectionId,
        usage: responseUsage,
        errorMessage: message,
      };
      attempts.push(attempt);
      lastFailure = { status: 502, upstreamStatus: status, message };
      if (plan.mode === "pinned") {
        return buildFailure(502, status, message, attempt, attempts, elapsedSince(startedAt, now));
      }
      cooldowns.set(attemptPlan.upstream.name, { expiresAtMs: now() + config.cooldownMs });
      continue;
    }

    const errorMessage = upstreamResult.readable
      ? getHttpErrorMessage(upstreamResult.body, status)
      : `Unreadable upstream error body (HTTP ${status})`;
    const attempt: SystemOneAttempt = {
      upstream: attemptPlan.upstream.name,
      status,
      model: attemptPlan.logModel,
      durationMs,
      connectionId: attemptPlan.upstream.connectionId,
      usage: responseUsage,
      errorMessage,
    };
    attempts.push(attempt);
    lastFailure = { status, upstreamStatus: status, message: errorMessage };

    if (plan.mode === "pinned") {
      return buildFailure(
        status,
        status,
        errorMessage,
        attempt,
        attempts,
        elapsedSince(startedAt, now)
      );
    }

    if (!isRetryableStatus(attemptPlan.upstream.name, status)) {
      return buildFailure(
        status,
        status,
        errorMessage,
        attempt,
        attempts,
        elapsedSince(startedAt, now)
      );
    }

    if (!(attemptPlan.upstream.name === "laya" && (status === 413 || status === 422))) {
      const retryAfterMs =
        status === 429
          ? getRetryAfterMs(upstreamResult.response.headers.get("retry-after"), now())
          : null;
      const cooldownMs = Math.min(retryAfterMs ?? config.cooldownMs, config.cooldownMs * 4);
      cooldowns.set(attemptPlan.upstream.name, { expiresAtMs: now() + cooldownMs });
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  const failure = lastFailure;
  if (!lastAttempt || !failure) {
    return {
      ok: false,
      status: 503,
      upstreamStatus: null,
      errorMessage: "No SystemOne upstream could be attempted",
      provider: "laya",
      model: "laya/default",
      attempts,
      latencyMs: elapsedSince(startedAt, now),
    };
  }

  return buildFailure(
    502,
    failure.upstreamStatus ?? failure.status,
    failure.message,
    lastAttempt,
    attempts,
    elapsedSince(startedAt, now)
  );
}
