import type { FmoPlanningPool } from "./types";
import { buildFmoTail, type FmoTailConfig, type FmoTailLogger, type FmoTailMember } from "./tail";

export interface FmoSolveCandidate {
  providerId: string;
  connectionId: string | null;
  modelId: string;
  capabilities: string[];
  contextWindow: number | null;
  isFree?: boolean;
  qualityScore: number | null;
  qualityScoreByComboId?: Record<string, number | null>;
  quotaTier: 1 | 2 | 3 | 4;
  capacityPerDay: number | null;
  capacityPerDayByComboId?: Record<string, number | null>;
  score: number;
  scoreByComboId?: Record<string, number>;
  degraded?: boolean;
}

export type FmoPlanMemberRole = "head" | "tail" | "canary";

export interface FmoPlanMember {
  role: FmoPlanMemberRole;
  providerId: string;
  modelId: string;
  connectionId: string | null;
  countedCapacity: number;
}

export interface FmoDecisionRecord {
  comboId: string;
  providerId: string;
  modelId: string;
  connectionId: string | null;
  role: FmoPlanMemberRole;
  outcome: "kept" | "displaced" | "dropped" | "seated";
  reason: string;
}

export interface FmoSolveResult {
  plans: Record<string, FmoPlanMember[]>;
  decisions: FmoDecisionRecord[];
}

export interface FmoIncumbencyPrior {
  byComboId: Record<
    string,
    Array<{ providerId: string; modelId: string; connectionId: string | null }>
  >;
}

export interface FmoSolveOptions {
  tailConfig?: FmoTailConfig;
  prior?: FmoIncumbencyPrior;
  logger?: FmoTailLogger;
}

type PoolDemand = { requests_per_day?: number };

const INCUMBENCY_MARGIN = 0.1;

function demandRequests(pool: FmoPlanningPool): number {
  return (pool.demand as PoolDemand).requests_per_day ?? 0;
}

function specificity(pool: FmoPlanningPool): number {
  return (
    (pool.constraints.required_capabilities?.length ?? 0) * 10 +
    pool.constraints.min_context_tokens / 100_000 +
    (pool.constraints.hard_gates?.length ?? 0)
  );
}

function candidateKey(
  candidate: Pick<FmoSolveCandidate, "providerId" | "modelId" | "connectionId">
): string {
  return `${candidate.providerId}:${candidate.modelId}:${candidate.connectionId ?? "unpinned"}`;
}

function hasCapabilities(candidate: FmoSolveCandidate, pool: FmoPlanningPool): boolean {
  return (pool.constraints.required_capabilities ?? []).every((capability) =>
    candidate.capabilities.includes(capability)
  );
}

function candidateCapacity(candidate: FmoSolveCandidate, pool: FmoPlanningPool): number | null {
  return candidate.capacityPerDayByComboId?.[pool.combo_id] ?? candidate.capacityPerDay;
}

function candidateQualityScore(candidate: FmoSolveCandidate, pool: FmoPlanningPool): number | null {
  return candidate.qualityScoreByComboId?.[pool.combo_id] ?? candidate.qualityScore;
}

function candidateScore(candidate: FmoSolveCandidate, pool: FmoPlanningPool): number {
  return candidate.scoreByComboId?.[pool.combo_id] ?? candidate.score;
}

function passesHardGates(candidate: FmoSolveCandidate, pool: FmoPlanningPool): boolean {
  return (
    !candidate.degraded &&
    (!pool.constraints.free_only || candidate.isFree === true) &&
    candidate.contextWindow !== null &&
    candidate.contextWindow >= pool.constraints.min_context_tokens &&
    hasCapabilities(candidate, pool)
  );
}

function inBand(candidate: FmoSolveCandidate, pool: FmoPlanningPool, relax = 0): boolean {
  const score = candidateQualityScore(candidate, pool);
  if (score === null) return false;
  const band = pool.constraints.quality_band;
  return score >= band.min - relax && score <= band.max + relax;
}

function hasCapabilitySurplus(candidate: FmoSolveCandidate, pool: FmoPlanningPool): boolean {
  const required = new Set(pool.constraints.required_capabilities ?? []);
  const candidateCapabilities = new Set(candidate.capabilities);

  for (const capability of required) {
    if (!candidateCapabilities.has(capability)) return false;
  }

  return candidate.capabilities.some((capability) => !required.has(capability));
}

function inRelaxedLowerBand(candidate: FmoSolveCandidate, pool: FmoPlanningPool): boolean {
  const score = candidateQualityScore(candidate, pool);
  if (score === null) return false;
  const band = pool.constraints.quality_band;
  return score < band.min && score >= band.min - band.relax;
}

function scarcity(pool: FmoPlanningPool, candidates: FmoSolveCandidate[]): number {
  const exactFitCount = candidates.filter(
    (candidate) => passesHardGates(candidate, pool) && inBand(candidate, pool)
  ).length;
  return exactFitCount === 0 ? Number.MAX_SAFE_INTEGER : 1 / exactFitCount;
}

function sortPools(pools: FmoPlanningPool[], candidates: FmoSolveCandidate[]): FmoPlanningPool[] {
  return [...pools].sort((left, right) => {
    const specificityDelta = specificity(right) - specificity(left);
    if (specificityDelta !== 0) return specificityDelta;
    return scarcity(right, candidates) - scarcity(left, candidates);
  });
}

function sortCandidates(
  candidates: FmoSolveCandidate[],
  pool: FmoPlanningPool,
  prior: FmoIncumbencyPrior | undefined
): FmoSolveCandidate[] {
  const incumbentKeys = new Set(
    (prior?.byComboId[pool.combo_id] ?? []).map((member) => candidateKey(member))
  );

  return [...candidates].sort((left, right) => {
    const leftStability = incumbentKeys.has(candidateKey(left)) ? 0.1 : 0;
    const rightStability = incumbentKeys.has(candidateKey(right)) ? 0.1 : 0;
    return (
      candidateScore(right, pool) + rightStability - (candidateScore(left, pool) + leftStability)
    );
  });
}

function toMember(candidate: FmoSolveCandidate, role: "head" | "canary"): FmoPlanMember {
  return {
    role,
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    connectionId: candidate.connectionId,
    countedCapacity: role === "canary" ? 0 : (candidate.capacityPerDay ?? 0),
  };
}

function toTailPlanMember(member: FmoTailMember): FmoPlanMember {
  return member;
}

function chooseCanary(
  pool: FmoPlanningPool,
  candidates: FmoSolveCandidate[],
  used: Set<string>
): FmoSolveCandidate | null {
  return (
    candidates.find(
      (candidate) =>
        candidate.quotaTier === 4 &&
        !used.has(candidateKey(candidate)) &&
        passesHardGates(candidate, pool) &&
        inBand(candidate, pool)
    ) ?? null
  );
}

function fillStep(
  pool: FmoPlanningPool,
  candidates: FmoSolveCandidate[],
  used: Set<string>,
  needed: number,
  decisions: FmoDecisionRecord[],
  reason: string
): { members: FmoPlanMember[]; covered: number } {
  const members: FmoPlanMember[] = [];
  let covered = 0;
  if (needed <= 0) return { members, covered };

  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (used.has(key)) continue;
    const capacity = candidateCapacity(candidate, pool) ?? 0;
    if (capacity <= 0) continue;

    used.add(key);
    covered += capacity;
    members.push(toMember(candidate, "head"));
    decisions.push({
      comboId: pool.combo_id,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      connectionId: candidate.connectionId,
      role: "head",
      outcome: "seated",
      reason,
    });

    if (covered >= needed) break;
  }

  return { members, covered };
}

function incumbentDropReason(candidate: FmoSolveCandidate | undefined): string {
  if (!candidate) return "missing-incumbent";
  if (candidate.degraded) return "degraded";
  return "ineligible-incumbent";
}

function isEligibleIncumbent(candidate: FmoSolveCandidate, pool: FmoPlanningPool): boolean {
  return (
    passesHardGates(candidate, pool) &&
    inBand(candidate, pool) &&
    (candidateCapacity(candidate, pool) ?? 0) > 0
  );
}

function findBestChallenger(
  pool: FmoPlanningPool,
  candidates: FmoSolveCandidate[],
  used: Set<string>,
  incumbent: FmoSolveCandidate
): FmoSolveCandidate | null {
  return (
    candidates
      .filter(
        (candidate) =>
          candidateKey(candidate) !== candidateKey(incumbent) &&
          !used.has(candidateKey(candidate)) &&
          passesHardGates(candidate, pool) &&
          inBand(candidate, pool) &&
          !hasCapabilitySurplus(candidate, pool) &&
          (candidateCapacity(candidate, pool) ?? 0) > 0
      )
      .sort((left, right) => candidateScore(right, pool) - candidateScore(left, pool))[0] ?? null
  );
}

function stabilityReason(
  prefix: "incumbent-kept" | "incumbent-displaced",
  challenger: FmoSolveCandidate | null,
  delta: number
): string {
  const challengerKey = challenger ? candidateKey(challenger) : "none";
  return `${prefix} challenger=${challengerKey} delta=${delta.toFixed(2)}`;
}

function buildPinnedProviderSet(plans: Record<string, FmoPlanMember[]>): Set<string> {
  const pinned = new Set<string>();
  for (const members of Object.values(plans)) {
    for (const member of members) {
      if (member.role === "head" && member.connectionId) pinned.add(member.providerId);
    }
  }
  return pinned;
}

function assertNoMixedHeadPinning(
  plans: Record<string, FmoPlanMember[]>,
  logger: FmoTailLogger = console
): void {
  const providerPinning = new Map<string, { pinned: boolean; unpinned: boolean }>();

  for (const members of Object.values(plans)) {
    for (const member of members) {
      if (member.role !== "head") continue;
      const state = providerPinning.get(member.providerId) ?? { pinned: false, unpinned: false };
      if (member.connectionId) state.pinned = true;
      else state.unpinned = true;
      providerPinning.set(member.providerId, state);
    }
  }

  for (const [providerId, state] of providerPinning) {
    if (!state.pinned || !state.unpinned) continue;
    logger.warn("FMO plan mixes pinned and unpinned head entries for provider", { providerId });
    throw new Error(
      `FMO plan has mixed pinned and unpinned head entries for provider ${providerId}`
    );
  }
}

export function solveFmoPools(
  pools: FmoPlanningPool[],
  candidates: FmoSolveCandidate[],
  options: FmoSolveOptions = {}
): FmoSolveResult {
  const plans: Record<string, FmoPlanMember[]> = {};
  const decisions: FmoDecisionRecord[] = [];
  const used = new Set<string>();
  const sortedPools = sortPools(pools, candidates);

  for (const pool of sortedPools) {
    const members: FmoPlanMember[] = [];
    const displacedKeys = new Set<string>();
    let covered = 0;

    const canary = chooseCanary(pool, candidates, used);
    if (canary) {
      used.add(candidateKey(canary));
      members.push(toMember(canary, "canary"));
      decisions.push({
        comboId: pool.combo_id,
        providerId: canary.providerId,
        modelId: canary.modelId,
        connectionId: canary.connectionId,
        role: "canary",
        outcome: "seated",
        reason: "quota-learning-canary",
      });
    }

    for (const priorMember of options.prior?.byComboId[pool.combo_id] ?? []) {
      const incumbent = candidates.find(
        (candidate) => candidateKey(candidate) === candidateKey(priorMember)
      );
      const key = candidateKey(priorMember);
      if (!incumbent || !isEligibleIncumbent(incumbent, pool)) {
        decisions.push({
          ...priorMember,
          comboId: pool.combo_id,
          role: "head",
          outcome: "dropped",
          reason: incumbentDropReason(incumbent),
        });
        continue;
      }
      if (used.has(key)) continue;

      const challenger = findBestChallenger(pool, candidates, used, incumbent);
      const delta = challenger
        ? candidateScore(challenger, pool) - candidateScore(incumbent, pool)
        : 0;
      if (challenger && delta > INCUMBENCY_MARGIN) {
        displacedKeys.add(key);
        decisions.push({
          ...priorMember,
          comboId: pool.combo_id,
          role: "head",
          outcome: "displaced",
          reason: stabilityReason("incumbent-displaced", challenger, delta),
        });
        continue;
      }

      const capacity = candidateCapacity(incumbent, pool) ?? 0;
      used.add(key);
      covered += capacity;
      members.push(toMember(incumbent, "head"));
      decisions.push({
        comboId: pool.combo_id,
        providerId: incumbent.providerId,
        modelId: incumbent.modelId,
        connectionId: incumbent.connectionId,
        role: "head",
        outcome: "kept",
        reason: stabilityReason("incumbent-kept", challenger, delta),
      });
    }

    const exact = sortCandidates(
      candidates.filter(
        (candidate) =>
          !displacedKeys.has(candidateKey(candidate)) &&
          passesHardGates(candidate, pool) &&
          inBand(candidate, pool) &&
          !hasCapabilitySurplus(candidate, pool)
      ),
      pool,
      options.prior
    );
    const exactStep = fillStep(
      pool,
      exact,
      used,
      demandRequests(pool) - covered,
      decisions,
      "exact-fit"
    );
    members.push(...exactStep.members);
    covered += exactStep.covered;

    if (covered < demandRequests(pool)) {
      const relaxed = sortCandidates(
        candidates.filter(
          (candidate) =>
            !displacedKeys.has(candidateKey(candidate)) &&
            passesHardGates(candidate, pool) &&
            !hasCapabilitySurplus(candidate, pool) &&
            !inBand(candidate, pool) &&
            inRelaxedLowerBand(candidate, pool)
        ),
        pool,
        options.prior
      );
      const relaxedStep = fillStep(
        pool,
        relaxed,
        used,
        demandRequests(pool) - covered,
        decisions,
        "relaxed-band"
      );
      members.push(...relaxedStep.members);
      covered += relaxedStep.covered;
    }

    if (covered < demandRequests(pool)) {
      const overflow = sortCandidates(
        candidates.filter(
          (candidate) =>
            !displacedKeys.has(candidateKey(candidate)) &&
            passesHardGates(candidate, pool) &&
            hasCapabilitySurplus(candidate, pool) &&
            inBand(candidate, pool, pool.constraints.quality_band.relax)
        ),
        pool,
        options.prior
      );
      const overflowStep = fillStep(
        pool,
        overflow,
        used,
        demandRequests(pool) - covered,
        decisions,
        "overflow"
      );
      members.push(...overflowStep.members);
    }

    plans[pool.combo_id] = members;
  }

  assertNoMixedHeadPinning(plans, options.logger);

  const pinnedProviders = buildPinnedProviderSet(plans);
  for (const pool of sortedPools) {
    const tail = buildFmoTail(
      pool,
      options.tailConfig ?? { entries: [] },
      pinnedProviders,
      options.logger
    ).map(toTailPlanMember);
    plans[pool.combo_id].push(...tail);
  }

  return { plans, decisions };
}
