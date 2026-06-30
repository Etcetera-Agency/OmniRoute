import type { FreeModelBudget } from "@omniroute/open-sse/config/freeModelCatalog.ts";
export type JsonRecord = Record<string, unknown>;

export interface FmoPoolTailConfig {
  providers: string[];
}

export interface FmoHeadCandidate {
  providerId: string;
  connectionId: string;
  connection?: JsonRecord;
  modelId: string;
  displayName: string;
  capabilities: string[];
  contextWindow: number | null;
  freeModel: FreeModelBudget | null;
  source: "synced";
}

export interface FmoQuotaAxes {
  requestsPerDay?: number;
  requestsPerMinute?: number;
  tokensPerDay?: number;
  tokensPerMonth?: number;
  resetAt?: string;
}

export interface FmoSearchSnapshot {
  query: string;
  provider: string;
  answerText: string | null;
  snippets: string[];
  evidenceUrls: string[];
  retrievedAt: string;
  contentHash: string;
}

export interface FmoQuotaClaimResponse {
  usable: boolean;
  axes: FmoQuotaAxes;
  sourceUrl: string;
  rationale?: string;
}

export type FmoQuotaTier = 1 | 2 | 3 | 4;

export interface FmoQuotaResult {
  tier: FmoQuotaTier;
  axes: FmoQuotaAxes | null;
  source: "live" | "static-catalog" | "search-research" | "none";
  searchSnapshot?: FmoSearchSnapshot;
}

export interface FmoPlanningPool {
  pool_id: string;
  combo_id: string;
  demand: {
    requests_per_day: number;
    consumers?: number;
  };
  constraints: {
    min_context_tokens: number;
    quality_band: {
      category: string;
      min: number;
      max: number;
      relax: number;
      source?: string;
      metric?: string;
    };
    required_capabilities: string[];
    hard_gates: string[];
    free_only: boolean;
  };
  tail: {
    strategy: string;
    mode: string;
    compatibility: string;
  };
  metadata?: JsonRecord;
  workload_class?: string;
}
