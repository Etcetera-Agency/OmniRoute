import type { FmoQuotaClaimResponse } from "./types";

export interface QuotaResearchInput {
  provider: string;
  provider_model_id: string;
  source_type: string;
  source_url: string;
  text: string;
  previous_limit: string;
}

export const QUOTA_RESEARCH_SYSTEM = [
  "You are the FMO quota-research extractor.",
  "Use only the supplied text. Never guess or use outside knowledge.",
  "Return JSON only, matching the provided QuotaClaimResponse schema.",
  "Set usable=false when the text does not contain explicit quota evidence.",
  "Every usable limit must be backed by the supplied evidence URL.",
  "Prefer cumulative free-tier limits such as requests/day, requests/month, tokens/day, or tokens/month.",
  "Use RPM/TPM only when no cumulative quota is present.",
  "When the text gives a range, choose the value that best matches previous_limit; if unknown, choose the lower bound.",
  "Reject marketing, paid-tier-only, vague, stale, or unrelated quota claims as unusable.",
].join("\n");

export const QUOTA_CLAIM_JSON_SCHEMA = {
  name: "QuotaClaimResponse",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["usable", "axes", "sourceUrl"],
    properties: {
      usable: { type: "boolean" },
      axes: {
        type: "object",
        additionalProperties: false,
        properties: {
          requestsPerDay: { type: "number", minimum: 0 },
          requestsPerMinute: { type: "number", minimum: 0 },
          tokensPerDay: { type: "number", minimum: 0 },
          tokensPerMonth: { type: "number", minimum: 0 },
          resetAt: { type: "string" },
        },
      },
      sourceUrl: { type: "string" },
      rationale: { type: "string" },
    },
  },
} as const satisfies {
  name: string;
  strict: boolean;
  schema: Record<string, unknown>;
};

function renderField(name: keyof QuotaResearchInput, value: string): string {
  return `<${name}>\n${value}\n</${name}>`;
}

export function renderQuotaResearchInput(input: QuotaResearchInput): string {
  return [
    renderField("provider", input.provider),
    renderField("provider_model_id", input.provider_model_id),
    renderField("source_type", input.source_type),
    renderField("source_url", input.source_url),
    renderField("previous_limit", input.previous_limit),
    renderField("text", input.text),
  ].join("\n\n");
}

export type QuotaClaimSchemaResponse = FmoQuotaClaimResponse;
