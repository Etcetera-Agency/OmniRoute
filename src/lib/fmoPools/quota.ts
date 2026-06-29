import { createHash } from "node:crypto";
import type { SearchResponse } from "@omniroute/open-sse/handlers/search.ts";
import { getUsageForProvider } from "@omniroute/open-sse/services/usage.ts";
import { buildSearchAttempts, runSearchChain, SearchError } from "@/lib/search/searchChain";
import type {
  FmoHeadCandidate,
  FmoQuotaAxes,
  FmoQuotaClaimResponse,
  FmoQuotaResult,
  FmoSearchSnapshot,
} from "./types";

export interface FmoQuotaDeps {
  getUsageForCandidate(candidate: FmoHeadCandidate): Promise<unknown>;
  searchResearchClaim(candidate: FmoHeadCandidate): Promise<FmoQuotaResult | null>;
}

export const defaultFmoQuotaDeps: FmoQuotaDeps = {
  getUsageForCandidate: async (candidate) =>
    getUsageForProvider({
      ...(candidate.connection ?? {}),
      id: candidate.connectionId,
      provider: candidate.providerId,
    }),
  searchResearchClaim,
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function pickFirstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeQuotaRecord(record: Record<string, unknown>): FmoQuotaAxes | null {
  const axes: FmoQuotaAxes = {};
  const requestsPerDay = pickFirstNumber(record, ["requestsPerDay", "requests_per_day", "rpd"]);
  const requestsPerMinute = pickFirstNumber(record, [
    "requestsPerMinute",
    "requests_per_minute",
    "rpm",
  ]);
  const tokensPerDay = pickFirstNumber(record, ["tokensPerDay", "tokens_per_day", "tpd"]);
  const tokensPerMonth = pickFirstNumber(record, [
    "tokensPerMonth",
    "tokens_per_month",
    "monthlyTokens",
  ]);

  if (requestsPerDay !== null) axes.requestsPerDay = requestsPerDay;
  if (requestsPerMinute !== null) axes.requestsPerMinute = requestsPerMinute;
  if (tokensPerDay !== null) axes.tokensPerDay = tokensPerDay;
  if (tokensPerMonth !== null) axes.tokensPerMonth = tokensPerMonth;
  if (typeof record.resetAt === "string") axes.resetAt = record.resetAt;

  return Object.keys(axes).length > 0 ? axes : null;
}

function findMatchingQuotaBucket(
  usage: Record<string, unknown>,
  modelId: string
): Record<string, unknown> | null {
  const buckets = toRecord(usage.quotas);
  const candidates = [modelId, modelId.split("/").at(-1) ?? modelId, "*"];
  for (const key of candidates) {
    const bucket = toRecord(buckets[key]);
    if (Object.keys(bucket).length > 0) return bucket;
  }
  return null;
}

export function normalizeFmoLiveQuotaAxes(
  usage: unknown,
  candidate: Pick<FmoHeadCandidate, "modelId">
): FmoQuotaAxes | null {
  const record = toRecord(usage);
  const bucket = findMatchingQuotaBucket(record, candidate.modelId);
  const axes = bucket ? normalizeQuotaRecord(bucket) : normalizeQuotaRecord(record);
  if (axes) return axes;

  const quotaCache = normalizeQuotaRecord(toRecord(record.quotaCache));
  return quotaCache;
}

export async function resolveFmoQuota(
  candidate: FmoHeadCandidate,
  deps: FmoQuotaDeps = defaultFmoQuotaDeps
): Promise<FmoQuotaResult> {
  const liveAxes = normalizeFmoLiveQuotaAxes(await deps.getUsageForCandidate(candidate), candidate);
  if (liveAxes) return { tier: 1, axes: liveAxes, source: "live" };

  if (candidate.freeModel?.monthlyTokens) {
    return {
      tier: 2,
      axes: { tokensPerMonth: candidate.freeModel.monthlyTokens },
      source: "static-catalog",
    };
  }

  const researched = await deps.searchResearchClaim(candidate);
  if (researched) return researched;

  return { tier: 4, axes: null, source: "none" };
}

export function buildFmoQuotaSearchQuery(
  providerId: string,
  modelId: string,
  date = new Date()
): string {
  const today = date.toISOString().slice(0, 10);
  if (modelId === "*") {
    return `Free-tier quota topology and limits for provider ${providerId}, current as of ${today}. Say if quota is provider/account-wide, model-group/per-model, or RPM-only. Include cumulative requests/day or month, tokens/day or month, requests/minute if no cumulative quota, hard stop, URLs.`;
  }

  const providerHint =
    providerId.startsWith("openai-compatible-") || providerId.length > 48
      ? ""
      : ` on provider ${providerId}`;
  return `Free-tier quota for model ${modelId}${providerHint}, current as of ${today}. Find cumulative requests/day, requests/month, tokens/day, tokens/month, whether quota is hard stop or throttle, and source URLs. Ignore RPM/TPM.`;
}

function snapshotHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export function summarizeFmoSearchResult(
  query: string,
  response: SearchResponse
): FmoSearchSnapshot {
  const snippets = response.results.map((result) => result.snippet).filter(Boolean);
  const evidenceUrls = response.results.map((result) => result.url).filter(Boolean);
  const answerText = response.answer?.text ?? null;

  return {
    query,
    provider: response.provider,
    answerText,
    snippets,
    evidenceUrls,
    retrievedAt: new Date().toISOString(),
    contentHash: snapshotHash([
      query,
      response.provider,
      answerText ?? "",
      ...snippets,
      ...evidenceUrls,
    ]),
  };
}

export function validateFmoQuotaClaimResponse(
  claim: FmoQuotaClaimResponse,
  snapshot: Pick<FmoSearchSnapshot, "answerText" | "snippets" | "evidenceUrls">
): FmoQuotaAxes | null {
  if (!claim.usable || !claim.sourceUrl || !snapshot.evidenceUrls.includes(claim.sourceUrl))
    return null;
  const text = [snapshot.answerText ?? "", ...snapshot.snippets].join("\n");
  if (!text.includes(claim.sourceUrl) && snapshot.evidenceUrls.length === 0) return null;
  return Object.keys(claim.axes).length > 0 ? claim.axes : null;
}

export async function extractQuotaClaimWithInternalLlm(_input: {
  provider: string;
  provider_model_id: string;
  source_type: string;
  source_url: string;
  text: string;
  previous_limit: string;
}): Promise<FmoQuotaClaimResponse | null> {
  return null;
}

export async function runFmoQuotaSearch(query: string): Promise<FmoSearchSnapshot | null> {
  const logger = { warn: () => undefined };
  const primaryBody = {
    query,
    provider: "gemini-grounded-search",
    search_type: "web",
    max_results: 10,
    time_range: "month",
  };

  const primaryAttempts = await buildSearchAttempts(primaryBody);
  if (!primaryAttempts.attempts) return null;

  try {
    return summarizeFmoSearchResult(
      query,
      await runSearchChain(primaryAttempts.attempts, primaryBody, logger)
    );
  } catch (error) {
    if (!(error instanceof SearchError) || error.statusCode !== 429) return null;
  }

  const fallbackBody = { ...primaryBody, provider: undefined };
  const fallbackAttempts = await buildSearchAttempts(fallbackBody);
  if (!fallbackAttempts.attempts) return null;
  return summarizeFmoSearchResult(
    query,
    await runSearchChain(fallbackAttempts.attempts, fallbackBody, logger)
  );
}

export async function searchResearchClaim(
  candidate: FmoHeadCandidate
): Promise<FmoQuotaResult | null> {
  // AICODE-NOTE: Tier-3 quota research stays in-process: searchChain + internal extractor only;
  // never route back through /api/v1/search or construct Request/Response.
  const query = buildFmoQuotaSearchQuery(candidate.providerId, candidate.modelId);
  const snapshot = await runFmoQuotaSearch(query);
  if (!snapshot) return null;

  const text = snapshot.answerText ?? snapshot.snippets.join("\n");
  const claim = await extractQuotaClaimWithInternalLlm({
    provider: candidate.providerId,
    provider_model_id: candidate.modelId,
    source_type: "search_summary",
    source_url: snapshot.evidenceUrls[0] ?? query,
    text,
    previous_limit: "unknown",
  });
  if (!claim) return null;

  const axes = validateFmoQuotaClaimResponse(claim, snapshot);
  return axes ? { tier: 3, axes, source: "search-research", searchSnapshot: snapshot } : null;
}
