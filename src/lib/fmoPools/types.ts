export interface FmoQuotaAxes {
  requestsPerDay?: number;
  requestsPerMinute?: number;
  tokensPerDay?: number;
  tokensPerMonth?: number;
  resetAt?: string;
}

export interface FmoQuotaClaimResponse {
  usable: boolean;
  axes: FmoQuotaAxes;
  sourceUrl: string;
  rationale?: string;
}
