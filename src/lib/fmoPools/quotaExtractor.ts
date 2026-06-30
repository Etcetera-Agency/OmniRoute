import { createLogger, generateRequestId } from "@omniroute/open-sse/utils/logger.ts";
import {
  QUOTA_CLAIM_JSON_SCHEMA,
  QUOTA_RESEARCH_SYSTEM,
  type QuotaResearchInput,
  renderQuotaResearchInput,
} from "./quotaResearchPrompt";
import type { FmoQuotaAxes, FmoQuotaClaimResponse } from "./types";

export interface QuotaExtractorDeps {
  getModelInfo(
    modelStr: string
  ): Promise<{ provider: string; model: string; [key: string]: unknown }>;
  getProviderCredentials(providerId: string): Promise<unknown>;
  handleChatCore(args: {
    body: Record<string, unknown>;
    modelInfo: Record<string, unknown>;
    credentials: unknown;
    log: ReturnType<typeof createLogger>;
  }): Promise<{ response: Response }>;
  isEnabled(): boolean;
  selectExtractorModel(): string;
}

const DEFAULT_EXTRACTOR_MODEL = "gemini/gemini-2.5-flash-lite";
const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

export function isQuotaExtractorEnabled(): boolean {
  const value = process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_ENABLED;
  return value === undefined || !DISABLED_VALUES.has(value.trim().toLowerCase());
}

export function selectExtractorModel(): string {
  return process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_MODEL?.trim() || DEFAULT_EXTRACTOR_MODEL;
}

export const defaultQuotaExtractorDeps: QuotaExtractorDeps = {
  getModelInfo: async (modelStr) => {
    const { getModelInfo } = await import("@/sse/services/model");
    return getModelInfo(modelStr);
  },
  getProviderCredentials: async (providerId) => {
    const { getProviderCredentials } = await import("@/sse/services/auth");
    return getProviderCredentials(providerId);
  },
  handleChatCore: async (args) => {
    const { handleChatCore } = await import("@omniroute/open-sse/handlers/chatCore.ts");
    return handleChatCore(args);
  },
  isEnabled: isQuotaExtractorEnabled,
  selectExtractorModel,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseAxes(value: unknown): FmoQuotaAxes | null {
  const record = asRecord(value);
  if (!record) return null;

  const axes: FmoQuotaAxes = {};
  const requestsPerDay = asNonNegativeNumber(record.requestsPerDay);
  const requestsPerMinute = asNonNegativeNumber(record.requestsPerMinute);
  const tokensPerDay = asNonNegativeNumber(record.tokensPerDay);
  const tokensPerMonth = asNonNegativeNumber(record.tokensPerMonth);

  if (requestsPerDay !== null) axes.requestsPerDay = requestsPerDay;
  if (requestsPerMinute !== null) axes.requestsPerMinute = requestsPerMinute;
  if (tokensPerDay !== null) axes.tokensPerDay = tokensPerDay;
  if (tokensPerMonth !== null) axes.tokensPerMonth = tokensPerMonth;
  if (typeof record.resetAt === "string") axes.resetAt = record.resetAt;

  return Object.keys(axes).length > 0 ? axes : {};
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export function parseQuotaClaim(content: unknown): FmoQuotaClaimResponse | null {
  if (typeof content !== "string" || content.trim().length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record || typeof record.usable !== "boolean" || typeof record.sourceUrl !== "string") {
    return null;
  }

  const axes = parseAxes(record.axes);
  if (!axes) return null;

  return {
    usable: record.usable,
    axes,
    sourceUrl: record.sourceUrl,
    ...(typeof record.rationale === "string" ? { rationale: record.rationale } : {}),
  };
}

function extractChoiceContent(payload: unknown): unknown {
  const record = asRecord(payload);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first?.message);
  return message?.content;
}

export async function runInternalChatPipeline(
  input: QuotaResearchInput,
  deps: QuotaExtractorDeps = defaultQuotaExtractorDeps
): Promise<FmoQuotaClaimResponse | null> {
  if (!deps.isEnabled()) return null;

  const model = deps.selectExtractorModel();
  const modelInfo = await deps.getModelInfo(model);
  const credentials = await deps.getProviderCredentials(modelInfo.provider);
  const body = {
    model,
    stream: false,
    temperature: 0,
    messages: [
      { role: "system", content: QUOTA_RESEARCH_SYSTEM },
      { role: "user", content: renderQuotaResearchInput(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: QUOTA_CLAIM_JSON_SCHEMA,
    },
  };

  // AICODE-NOTE: FMO tier-3 extraction calls handleChatCore directly; no Request/fetch route boundary.
  const { response } = await deps.handleChatCore({
    body,
    modelInfo,
    credentials,
    log: createLogger(generateRequestId()),
  });
  if (!response.ok) return null;

  return parseQuotaClaim(extractChoiceContent(await response.json().catch(() => null)));
}
