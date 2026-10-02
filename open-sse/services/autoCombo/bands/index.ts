import { buildCapabilityCheck } from "./capabilities";
import { getBandConfig } from "./config";
import { createQualityBandCheck } from "./filter";
import { parseBandId, type ParsedBandId } from "./grammar";

export const BAND_THRIFTY_RUNG_ORDER = [
  "free",
  "keyless",
  "subscription",
  "cheap",
  "premium",
] as const;

export { parseBandId };
export type { BandCapability, BandTask, ParsedBandId, QualityBand } from "./grammar";

export interface ParsedBandCategory extends ParsedBandId {
  /** Canonical opaque category; capability order does not affect its identity. */
  category: string;
  hasReasoning: boolean;
  hasVision: boolean;
}

export function parseBandCategory(value: string | undefined): ParsedBandCategory | null {
  const parsed = parseBandId(value);
  if (!parsed) return null;

  return {
    ...parsed,
    category: [parsed.task, parsed.band, ...parsed.capabilities].join("_"),
    hasReasoning: parsed.capabilities.includes("reasoning"),
    hasVision: parsed.capabilities.includes("vision"),
  };
}

export function isBandsEnabled(): boolean {
  return process.env.OMNIROUTE_AUTO_BANDS === "1" || process.env.OMNIROUTE_AUTO_BANDS === "true";
}

export interface BandCandidate {
  provider: string;
  model: string;
  resolvedSupportsVision?: boolean;
  resolvedReasoning?: boolean;
  resolvedSupportsThinking?: boolean;
}

export type BandCandidateFilter = (candidate: BandCandidate) => boolean;

// AICODE-NOTE: Band predicates constrain the pool only when the feature flag is
// enabled; quality stays ahead of capability resolution to avoid needless lookups.
export function buildBandCheck(category?: string): BandCandidateFilter | null {
  if (!isBandsEnabled()) return null;

  const parsed = parseBandCategory(category);
  if (!parsed) return null;

  const qualityCheck = createQualityBandCheck(parsed.task, parsed.band);
  const capabilityCheck = buildCapabilityCheck(
    parsed.capabilities,
    getBandConfig().capabilities.so.unknown
  );

  return function checkBandCandidate(candidate: BandCandidate): boolean {
    return qualityCheck(candidate) && capabilityCheck(candidate);
  };
}

export type BandThriftyRung = (typeof BAND_THRIFTY_RUNG_ORDER)[number];

export interface BandBillingPriorityAssignment {
  provider: string;
  model: string;
  connectionId: string;
  rung: BandThriftyRung;
}

export interface BandBillingPriority {
  category: string;
  tier: "thrifty";
  assignments: BandBillingPriorityAssignment[];
}

interface BandPoolCandidate {
  connectionId: string | null;
  allowedConnectionIds?: readonly string[];
}

interface BandAccountCandidate extends BandPoolCandidate {
  provider: string;
  model: string;
}

function getBandCandidateConnectionIds(candidate: BandPoolCandidate): string[] {
  const connectionIds =
    candidate.allowedConnectionIds ??
    (candidate.connectionId === null ? [] : [candidate.connectionId]);
  return connectionIds.filter(
    (connectionId): connectionId is string =>
      typeof connectionId === "string" && connectionId.length > 0
  );
}

/**
 * Capture the exact eligible account rung set for the final Auto selector.
 * An explicit allowlist always wins over a direct connection pin, so a
 * conflicting pin cannot manufacture a priority assignment.
 */
export function buildBandBillingPriority<T extends BandAccountCandidate>(
  pool: T[],
  category: string | undefined,
  tier: string | undefined,
  resolveRung: (candidate: T, connectionId: string) => BandThriftyRung
): BandBillingPriority | null {
  const parsed = parseBandCategory(category);
  if (!isBandsEnabled() || tier !== "thrifty" || !parsed) return null;

  const assignments = pool.flatMap((candidate) =>
    getBandCandidateConnectionIds(candidate).map((connectionId) => ({
      provider: candidate.provider,
      model: candidate.model,
      connectionId,
      rung: resolveRung(candidate, connectionId),
    }))
  );

  return { category: parsed.category, tier: "thrifty", assignments };
}

/**
 * Reorder only enabled band-thrifty pools. The resolver sees each candidate's
 * current connection allowlist, so account narrowing can run before this sort.
 * This helper never removes candidates or changes their connection IDs.
 */
export function orderBandPoolByThriftyRung<T extends BandPoolCandidate>(
  pool: T[],
  category: string | undefined,
  tier: string | undefined,
  resolveRung: (candidate: T, connectionId: string) => BandThriftyRung
): T[] {
  if (pool.length < 2 || !isBandsEnabled() || tier !== "thrifty" || !parseBandCategory(category)) {
    return pool;
  }

  const rungOrder = new Map<BandThriftyRung, number>(
    BAND_THRIFTY_RUNG_ORDER.map((rung, index) => [rung, index])
  );
  return pool
    .map((candidate, index) => {
      const rank = getBandCandidateConnectionIds(candidate).reduce(
        (best, connectionId) =>
          Math.min(best, rungOrder.get(resolveRung(candidate, connectionId)) ?? Infinity),
        Infinity
      );
      return { candidate, index, rank };
    })
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ candidate }) => candidate);
}
