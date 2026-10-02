import {
  errorResponse,
  unavailableResponse,
  errorResponseWithComboDiagnostics,
} from "../../utils/error.ts";
import { BudgetExceededError, selectProvider as selectAutoProvider } from "../autoCombo/engine.ts";
import type { ScoringWeights } from "../autoCombo/scoring.ts";
import {
  resolveRequestModePack,
  parseRequestBudgetCap,
  parseRequestBudgetFallback,
} from "../autoCombo/requestControls.ts";
import { selectWithStrategy } from "../autoCombo/routerStrategy.ts";
import { buildComplexityRoutingHint } from "../autoCombo/complexityRouter";
import { getModePack } from "../autoCombo/modePacks.ts";
import { recordComboIntent } from "../comboMetrics.ts";
import { estimateTokens } from "../contextManager.ts";
import { classifyWithConfig } from "../intentClassifier.ts";
import type { RoutingHint } from "../manifestAdapter";
import { parseModel } from "../model.ts";
import { supportsToolCalling } from "../modelCapabilities.ts";
import type { ResilienceSettings } from "../../../src/lib/resilience/settings";
import { parseAutoConfig } from "./autoConfig.ts";
import { dedupeTargetsByExecutionKey } from "./comboData.ts";
import {
  BAND_THRIFTY_RUNG_ORDER,
  isBandsEnabled,
  parseBandCategory,
  type BandThriftyRung,
} from "../autoCombo/bands";
import {
  getModelContextLimitForModelString,
  providerSupportsEmulatedToolCalling,
} from "./comboStructure.ts";
import {
  calculatePromptCacheAffinityScores,
  promptCacheTargetIdentity,
} from "./promptCacheAffinity.ts";
import type { ResetWindowConfig } from "./quotaScoring.ts";
import {
  _registerExecutionCandidates,
  expandAutoComboCandidatePool,
  extractPromptForIntent,
  getIntentConfig,
  mapIntentToTaskType,
  scoreAutoTargets,
} from "./autoStrategy.ts";
import type {
  AutoProviderCandidate,
  ComboLike,
  ComboLogger,
  ResolvedComboTarget,
} from "./types.ts";

/**
 * Dependency-injected `buildAutoCandidates` — it lives in `combo.ts` (the host of
 * this leaf), so importing it directly would create an import cycle. Passing it
 * through `deps` keeps this module acyclic (same pattern as `buildTargetTimeoutRunner`).
 */
type BuildAutoCandidates = (
  targets: ResolvedComboTarget[],
  comboName: string,
  sessionId?: string | null,
  resetWindowConfig?: ResetWindowConfig,
  resilienceSettings?: ResilienceSettings | null
) => Promise<AutoProviderCandidate[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bandAccountKey(provider: string, model: string, connectionId: string): string {
  return JSON.stringify([provider, model, connectionId]);
}

function bandCandidateKey(candidate: AutoProviderCandidate): string {
  return JSON.stringify([
    candidate.stepId,
    candidate.executionKey,
    candidate.provider,
    candidate.model,
    candidate.connectionId ?? null,
  ]);
}

function getBandBillingAssignments(combo: ComboLike): Map<string, BandThriftyRung> | null {
  if (!isBandsEnabled()) return null;

  const autoConfig = isRecord(combo.autoConfig) ? combo.autoConfig : null;
  const nestedAutoConfig = isRecord(combo.config?.auto) ? combo.config.auto : null;
  const raw = autoConfig?.bandBillingPriority ?? nestedAutoConfig?.bandBillingPriority;
  if (!isRecord(raw) || raw.tier !== "thrifty" || !parseBandCategory(String(raw.category ?? ""))) {
    return raw === undefined ? null : new Map();
  }

  if (!Array.isArray(raw.assignments)) return new Map();
  const assignments = new Map<string, BandThriftyRung>();
  for (const entry of raw.assignments) {
    if (!isRecord(entry)) continue;
    const { provider, model, connectionId, rung } = entry;
    if (
      typeof provider !== "string" ||
      typeof model !== "string" ||
      typeof connectionId !== "string" ||
      !BAND_THRIFTY_RUNG_ORDER.includes(rung as BandThriftyRung)
    ) {
      continue;
    }
    assignments.set(bandAccountKey(provider, model, connectionId), rung as BandThriftyRung);
  }
  return assignments;
}

type BandCandidateTarget = {
  candidate: AutoProviderCandidate;
  target: ResolvedComboTarget;
  rung: BandThriftyRung;
};

function resolveBandCandidateTargets(
  candidates: AutoProviderCandidate[],
  targets: ResolvedComboTarget[],
  assignments: ReadonlyMap<string, BandThriftyRung>
): BandCandidateTarget[] {
  const targetsByExecutionKey = new Map(targets.map((target) => [target.executionKey, target]));
  const resolved: BandCandidateTarget[] = [];

  for (const candidate of candidates) {
    const connectionId = candidate.connectionId;
    if (typeof connectionId !== "string" || connectionId.length === 0) continue;

    const rung = assignments.get(bandAccountKey(candidate.provider, candidate.model, connectionId));
    if (!rung) continue;

    const baseTarget =
      targetsByExecutionKey.get(candidate.executionKey) ||
      targets.find(
        (target) =>
          target.stepId === candidate.stepId &&
          target.provider === candidate.provider &&
          target.modelStr === candidate.modelStr
      );
    if (!baseTarget) continue;

    // AICODE-NOTE: The explicit allowlist outranks a stale direct account pin;
    // the band marker still admits only exact accounts from that allowlist.
    if (
      (Array.isArray(baseTarget.allowedConnectionIds) &&
        !baseTarget.allowedConnectionIds.includes(connectionId)) ||
      (!Array.isArray(baseTarget.allowedConnectionIds) &&
        baseTarget.connectionId &&
        baseTarget.connectionId !== connectionId)
    ) {
      continue;
    }

    resolved.push({
      candidate,
      rung,
      target: {
        ...baseTarget,
        stepId: candidate.stepId,
        executionKey: candidate.executionKey,
        modelStr: candidate.modelStr,
        provider: candidate.provider,
        connectionId,
      },
    });
  }
  return resolved;
}

export interface ResolveAutoStrategyDeps {
  orderedTargets: ResolvedComboTarget[];
  body: Record<string, unknown>;
  combo: ComboLike;
  settings: Record<string, unknown> | null | undefined;
  config: { complexityAwareRouting?: boolean; compatFilterFailOpen?: boolean };
  relayOptions?: {
    bypassProviderQuotaPolicy?: boolean;
    sessionId?: string | null;
    /** Per-request X-OmniRoute-Mode value (#6024/#6025). */
    mode?: string | null;
    /** Per-request X-OmniRoute-Budget value in USD (#6023). */
    budgetCap?: number | null;
    /** Per-request X-OmniRoute-Budget-Fallback value ("cheapest" | "strict") — #3470. */
    budgetFallback?: "cheapest" | "strict" | null;
  } | null;
  resilienceSettings: ResilienceSettings;
  log: ComboLogger;
  buildAutoCandidates: BuildAutoCandidates;
}

export type ResolveAutoStrategyResult =
  | { earlyResponse: Response }
  | { orderedTargets: ResolvedComboTarget[]; autoUsedExplicitRouter: boolean };

export interface EvaluateAutoCandidatesOptions {
  targets: ResolvedComboTarget[];
  comboName: string;
  body: Record<string, unknown>;
  taskType: string;
  weights: ScoringWeights;
  sessionId?: string | null;
  resetWindowConfig?: ResetWindowConfig;
  resilienceSettings?: ResilienceSettings | null;
  manifestHint?: RoutingHint | null;
  buildAutoCandidates: BuildAutoCandidates;
}

export async function evaluateAutoCandidates(options: EvaluateAutoCandidatesOptions) {
  const builtCandidates = await options.buildAutoCandidates(
    options.targets,
    options.comboName,
    options.sessionId,
    options.resetWindowConfig,
    options.resilienceSettings
  );
  const cacheAffinityScores = calculatePromptCacheAffinityScores(
    builtCandidates,
    options.body,
    options.sessionId
  );
  const candidates = builtCandidates.map((candidate) => ({
    ...candidate,
    cacheAffinity: cacheAffinityScores.get(promptCacheTargetIdentity(candidate)) ?? 0,
  }));
  const routableCandidates = candidates.filter(
    (candidate) => candidate.quotaCutoffBlocked !== true
  );
  return {
    sourceCandidates: builtCandidates,
    candidates,
    routableCandidates,
    scoredTargets: scoreAutoTargets(
      options.targets,
      routableCandidates,
      options.taskType,
      options.weights,
      options.manifestHint
    ),
  };
}

/**
 * Resolve target ordering for the `auto` combo strategy.
 *
 * Extracted verbatim from `handleComboChat`'s `if (strategy === "auto")` branch:
 * tool-calling + context-window pre-filters, intent classification, candidate
 * building (quota cutoff), explicit-router vs rules selection, complexity-aware
 * scoring and final dedup ordering. Behavior is byte-identical to the previous
 * inline block; the two `return unavailableResponse(...)` exits become
 * `{ earlyResponse }` so the host can decide to return them, and the mutated
 * `orderedTargets` / `autoUsedExplicitRouter` are returned instead of closed over.
 */
export async function resolveAutoStrategyOrder(
  deps: ResolveAutoStrategyDeps
): Promise<ResolveAutoStrategyResult> {
  const {
    body,
    combo,
    settings,
    config,
    relayOptions,
    resilienceSettings,
    log,
    buildAutoCandidates,
  } = deps;
  let orderedTargets = deps.orderedTargets;
  let autoUsedExplicitRouter = false;

  const requestHasTools = Array.isArray(body?.tools) && body.tools.length > 0;
  let eligibleTargets = [...orderedTargets];
  const compatFilterFailOpen =
    config?.compatFilterFailOpen === true ||
    (settings as { compatFilterFailOpen?: unknown } | null | undefined)?.compatFilterFailOpen ===
      true;

  if (requestHasTools) {
    // Keep #5240 prompt-emulation providers (toolCalling:"emulated") even when
    // registry/capability rows honestly report toolCalling:false.
    const filtered = eligibleTargets.filter(
      (target) =>
        supportsToolCalling(target.modelStr) || providerSupportsEmulatedToolCalling(target.provider)
    );
    if (filtered.length > 0) {
      eligibleTargets = filtered;
    } else if (compatFilterFailOpen) {
      log.warn(
        "COMBO",
        "Auto strategy: all candidates filtered by tool-calling policy, falling back to full pool (compatFilterFailOpen)"
      );
    } else {
      // #8488: fail closed with an explicit compatibility error instead of
      // re-admitting tool-incapable targets.
      const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
      return {
        earlyResponse: errorResponseWithComboDiagnostics(
          400,
          `No target in combo ${combo.name} supports tool calling; request carried ${toolCount} tools`,
          {
            poolSize: eligibleTargets.length,
            attempted: 0,
            excluded: eligibleTargets.map((target) => ({
              provider: target.provider,
              model: target.modelStr,
              reason: "tools",
            })),
            attemptOrder: [],
            terminalReason: "capability_mismatch",
          },
          { code: "capability_mismatch", type: "invalid_request_error" }
        ),
      };
    }
  }

  // Context-window pre-filter (#1808)
  // Estimate input tokens once; exclude candidates whose known context limit is too small.
  // Uses the same 4-chars-per-token heuristic as contextManager.ts::compressContext().
  // Null/unknown limits are treated as "include" to avoid incorrectly dropping valid targets.
  const requestMessages = body.messages;
  const estimatedInputTokens = estimateTokens(
    typeof requestMessages === "string" ||
      (requestMessages !== null && typeof requestMessages === "object")
      ? requestMessages
      : []
  );
  if (estimatedInputTokens > 0) {
    const filteredByContext = eligibleTargets.filter((target) => {
      const limit = getModelContextLimitForModelString(target.modelStr);
      if (limit === null || limit === undefined) return true; // unknown — include to be safe
      return limit >= estimatedInputTokens;
    });
    if (filteredByContext.length > 0) {
      log.debug?.(
        "COMBO",
        `Auto strategy: context-window filter kept ${filteredByContext.length}/${eligibleTargets.length} candidates (est. ${estimatedInputTokens} tokens)`
      );
      eligibleTargets = filteredByContext;
    } else {
      log.warn(
        "COMBO",
        `Auto strategy: all candidates filtered by approximate context-window policy (est. ${estimatedInputTokens} tokens), falling back to full pool`
      );
    }

    eligibleTargets = await expandAutoComboCandidatePool(eligibleTargets, combo);
  }

  const prompt = extractPromptForIntent(body);
  const systemPrompt = typeof combo?.system_message === "string" ? combo.system_message : undefined;
  const intentConfig = getIntentConfig(settings, combo);
  const intent = classifyWithConfig(prompt, intentConfig, systemPrompt);
  recordComboIntent(combo.name, intent);
  const taskType = mapIntentToTaskType(intent);

  const {
    routingStrategy,
    candidatePool,
    weights: configWeights,
    explorationRate,
    budgetCap: configBudgetCap,
    budgetFallback: configBudgetFallback,
    modePack: configModePack,
    resetWindowConfig,
    slaPolicy,
  } = parseAutoConfig(combo, eligibleTargets);

  // Per-request overrides (#6023 / #6024 / #6025 / #3470): X-OmniRoute-Budget,
  // X-OmniRoute-Budget-Fallback and X-OmniRoute-Mode headers (threaded via
  // relayOptions) take precedence over the combo's stored config for this single
  // request. Unknown/garbage header values are ignored so the saved config is
  // preserved.
  const requestBudgetCap = parseRequestBudgetCap(relayOptions?.budgetCap);
  const budgetCap = requestBudgetCap ?? configBudgetCap;
  const requestBudgetFallback = parseRequestBudgetFallback(relayOptions?.budgetFallback);
  const budgetFallback = requestBudgetFallback ?? configBudgetFallback;
  const requestModePack = resolveRequestModePack(relayOptions?.mode);
  const modePack = requestModePack.override ? requestModePack.modePack : configModePack;
  // #7008: `weights` must track the *effective* (post-override) modePack, not just
  // the combo's stored one. `selectAutoProvider()` (engine.ts) already re-derives
  // weights internally from the `modePack` it's given, so it correctly reacts to a
  // per-request X-OmniRoute-Mode override — but `scoreAutoTargets()` (the fallback
  // ranking below) has no such re-derivation and only ever sees whatever `weights`
  // it's handed. Without this recompute, a request overriding e.g. `quality-first`
  // to `ship-fast` would select its primary target under ship-fast weights but rank
  // every fallback under the stale quality-first weights — the same
  // select-under-one-policy/rank-under-another bug this module's original fix
  // (parseAutoConfig honoring the combo's own stored modePack) set out to close.
  const weights = modePack ? getModePack(modePack) || configWeights : configWeights;
  if (
    requestModePack.override ||
    requestBudgetCap !== undefined ||
    requestBudgetFallback !== undefined
  ) {
    log.debug?.(
      "COMBO",
      `Auto strategy: per-request controls applied (mode=${
        requestModePack.override ? (requestModePack.modePack ?? "balanced") : "—"
      }, budgetCap=${requestBudgetCap ?? "—"}, budgetFallback=${requestBudgetFallback ?? "—"})`
    );
  }

  let lastKnownGoodProvider: string | undefined;
  try {
    const { getLKGP } = await import("@/lib/db/settings");
    const lkgp = await getLKGP(combo.name, combo.id || combo.name);
    if (lkgp) lastKnownGoodProvider = lkgp.provider;
  } catch (err) {
    log.warn("COMBO", "Failed to retrieve Last Known Good Provider. This is non-fatal.", { err });
  }

  const autoCandidateResilienceSettings =
    relayOptions?.bypassProviderQuotaPolicy === true
      ? {
          ...resilienceSettings,
          quotaPreflight: {
            ...resilienceSettings.quotaPreflight,
            enabled: false,
          },
        }
      : resilienceSettings;
  // Complexity-aware routing (2026, opt-in): classify the request's
  // difficulty and feed a tier hint into scoring so tierAffinity /
  // specificityMatch favor candidates whose tier matches the request.
  const autoManifestHint: RoutingHint | null =
    config.complexityAwareRouting === true
      ? await buildComplexityRoutingHint(
          eligibleTargets.filter((t) => t.kind === "model"),
          body,
          log
        )
      : null;

  const bandBillingAssignments = getBandBillingAssignments(combo);
  const scoringTargets = eligibleTargets;
  const evaluated = await evaluateAutoCandidates({
    targets: eligibleTargets,
    comboName: combo.name,
    body,
    taskType,
    weights,
    sessionId: relayOptions?.sessionId,
    resetWindowConfig,
    resilienceSettings: autoCandidateResilienceSettings,
    manifestHint: autoManifestHint,
    buildAutoCandidates,
  });
  let { sourceCandidates, candidates, routableCandidates, scoredTargets } = evaluated;
  let bandCandidateTargets: BandCandidateTarget[] | null = null;
  if (bandBillingAssignments) {
    // AICODE-NOTE: A null-connection logical target means active fanout found
    // no account intersection. Do not let a stale cache or later credential
    // lookup pick an unranked account from its broad allowlist; only an exact
    // provider/model/account marker survives selection and fallback.
    bandCandidateTargets = resolveBandCandidateTargets(
      sourceCandidates,
      scoringTargets,
      bandBillingAssignments
    );
    const matchedCandidates = new Set(
      bandCandidateTargets.map(({ candidate }) => bandCandidateKey(candidate))
    );
    sourceCandidates = sourceCandidates.filter((candidate) =>
      matchedCandidates.has(bandCandidateKey(candidate))
    );
    candidates = candidates.filter((candidate) =>
      matchedCandidates.has(bandCandidateKey(candidate))
    );
    routableCandidates = routableCandidates.filter((candidate) =>
      matchedCandidates.has(bandCandidateKey(candidate))
    );
    eligibleTargets = bandCandidateTargets.map(({ target }) => target);
    scoredTargets = scoreAutoTargets(
      eligibleTargets,
      routableCandidates,
      taskType,
      weights,
      autoManifestHint
    );
  }
  for (let index = 0; index < sourceCandidates.length; index += 1) {
    sourceCandidates[index].cacheAffinity = candidates[index]?.cacheAffinity;
  }
  const quotaBlockedCount = candidates.length - routableCandidates.length;
  if (quotaBlockedCount > 0) {
    log.info(
      "COMBO",
      `Auto strategy: quota cutoff skipped ${quotaBlockedCount}/${candidates.length} account candidates`
    );
  }
  // G2: Register candidates so chatCore can mark quotaSoftPenalty via setCandidateQuotaSoftPenalty.
  _registerExecutionCandidates(routableCandidates);
  if (candidates.length > 0 && routableCandidates.length === 0) {
    return {
      earlyResponse: unavailableResponse(
        429,
        "All auto strategy candidates are below configured quota cutoffs"
      ),
    };
  }
  if (routableCandidates.length > 0) {
    if (bandCandidateTargets && bandBillingAssignments) {
      const selectionContext = {
        taskType,
        requestHasTools,
        lastKnownGoodProvider,
        // #11181: preserve the persisted LKGP switch inside each billing rung.
        lkgpEnabled: (settings as { lkgpEnabled?: unknown } | null | undefined)?.lkgpEnabled as
          boolean | undefined,
        estimatedInputTokens,
        sla: slaPolicy,
        weights,
        explorationRate,
      };
      const selectionByRung = new Map<
        BandThriftyRung,
        { target: ResolvedComboTarget; reason: string; explicit: boolean }
      >();
      const budgetBlockedRungs = new Set<BandThriftyRung>();
      let budgetExceeded: BudgetExceededError | null = null;

      for (const rung of BAND_THRIFTY_RUNG_ORDER) {
        const rungCandidates = routableCandidates.filter(
          (candidate) =>
            bandBillingAssignments.get(
              bandAccountKey(candidate.provider, candidate.model, candidate.connectionId ?? "")
            ) === rung
        );
        if (rungCandidates.length === 0) continue;

        let selected: { provider: string; model: string; connectionId?: string | null } | null =
          null;
        let reason = "";
        let explicit = false;
        if (routingStrategy !== "rules") {
          try {
            const decision = selectWithStrategy(rungCandidates, selectionContext, routingStrategy);
            selected = decision;
            reason = decision.reason;
            explicit = true;
          } catch (err) {
            log.warn(
              "COMBO",
              `Auto strategy '${routingStrategy}' failed for billing rung '${rung}' (${err?.message || "unknown"}), falling back to rules`
            );
          }
        }

        if (!selected) {
          try {
            const decision = selectAutoProvider(
              {
                id: combo.id || combo.name,
                name: combo.name,
                type: "auto",
                candidatePool,
                weights,
                modePack,
                budgetCap,
                budgetFallback,
                estimatedInputTokens,
                explorationRate,
              },
              rungCandidates,
              taskType
            );
            selected = decision;
            reason = `score=${decision.score.toFixed(3)}${decision.isExploration ? " (exploration)" : ""}`;
          } catch (err) {
            if (!(err instanceof BudgetExceededError)) throw err;
            budgetExceeded ??= err;
            budgetBlockedRungs.add(rung);
            continue;
          }
        }

        const parsedSelectedModel = parseModel(selected.model).model || selected.model;
        const scoredWinner = scoredTargets.find((entry) => {
          const parsed = parseModel(entry.target.modelStr);
          const targetRung = bandBillingAssignments.get(
            bandAccountKey(
              entry.target.provider,
              parsed.model || entry.target.modelStr,
              entry.target.connectionId ?? ""
            )
          );
          return (
            targetRung === rung &&
            entry.target.provider === selected.provider &&
            (parsed.model || entry.target.modelStr) === parsedSelectedModel &&
            (!selected.connectionId || entry.target.connectionId === selected.connectionId)
          );
        })?.target;
        const candidateWinner = bandCandidateTargets.find(
          ({ candidate, target, rung: candidateRung }) => {
            const parsed = parseModel(target.modelStr);
            return (
              candidate.quotaCutoffBlocked !== true &&
              candidateRung === rung &&
              candidate.provider === selected?.provider &&
              (parsed.model || target.modelStr) === parsedSelectedModel &&
              (!selected?.connectionId || candidate.connectionId === selected.connectionId)
            );
          }
        )?.target;
        const winner = scoredWinner || candidateWinner;
        if (winner) selectionByRung.set(rung, { target: winner, reason, explicit });
      }

      if (selectionByRung.size === 0 && budgetExceeded) {
        return { earlyResponse: errorResponse(402, budgetExceeded.message) };
      }

      const scoredByRung = new Map<BandThriftyRung, ResolvedComboTarget[]>();
      for (const entry of scoredTargets) {
        const { target } = entry;
        const parsed = parseModel(target.modelStr);
        const rung = bandBillingAssignments.get(
          bandAccountKey(
            target.provider,
            parsed.model || target.modelStr,
            target.connectionId ?? ""
          )
        );
        if (!rung || budgetBlockedRungs.has(rung)) continue;
        const targetsForRung = scoredByRung.get(rung) ?? [];
        targetsForRung.push(target);
        scoredByRung.set(rung, targetsForRung);
      }

      const fallbackByRung = new Map<BandThriftyRung, ResolvedComboTarget[]>();
      const quotaBlockedByRung = new Map<BandThriftyRung, ResolvedComboTarget[]>();
      for (const entry of bandCandidateTargets) {
        if (budgetBlockedRungs.has(entry.rung)) continue;
        const fallbackByRungForCandidate =
          entry.candidate.quotaCutoffBlocked === true ? quotaBlockedByRung : fallbackByRung;
        const targetsForRung = fallbackByRungForCandidate.get(entry.rung) ?? [];
        targetsForRung.push(entry.target);
        fallbackByRungForCandidate.set(entry.rung, targetsForRung);
      }

      const bandOrderedTargets: ResolvedComboTarget[] = [];
      const seenExecutionKeys = new Set<string>();
      const appendUnique = (target: ResolvedComboTarget | undefined) => {
        if (!target || seenExecutionKeys.has(target.executionKey)) return;
        seenExecutionKeys.add(target.executionKey);
        bandOrderedTargets.push(target);
      };
      for (const rung of BAND_THRIFTY_RUNG_ORDER) {
        if (budgetBlockedRungs.has(rung)) continue;
        const rankedForRung = scoredByRung.get(rung) ?? [];
        const selected = selectionByRung.get(rung)?.target;
        const firstForRung = selected || rankedForRung[0] || fallbackByRung.get(rung)?.[0];
        appendUnique(firstForRung);
        for (const target of rankedForRung) appendUnique(target);
        for (const target of fallbackByRung.get(rung) ?? []) appendUnique(target);
      }

      // AICODE-NOTE: Hard-cutoff candidates stay available for terminal retry,
      // but never compete with routable accounts for a primary or rung fallback.
      for (const rung of BAND_THRIFTY_RUNG_ORDER) {
        if (budgetBlockedRungs.has(rung)) continue;
        for (const target of quotaBlockedByRung.get(rung) ?? []) appendUnique(target);
      }

      const primaryTarget = bandOrderedTargets[0];
      if (!primaryTarget) {
        return {
          earlyResponse: unavailableResponse(
            429,
            "No auto strategy targets remained after account-rung filtering"
          ),
        };
      }
      const primaryRung = bandCandidateTargets.find(
        (entry) => entry.target.executionKey === primaryTarget.executionKey
      )?.rung;
      const primarySelection = primaryRung ? selectionByRung.get(primaryRung) : undefined;
      autoUsedExplicitRouter = primarySelection?.explicit ?? false;
      orderedTargets = bandOrderedTargets;

      log.info(
        "COMBO",
        `Auto selection: ${primaryTarget.modelStr} | intent=${intent} task=${taskType} | strategy=${routingStrategy} | ${primarySelection?.reason || "score fallback"}`
      );
    } else {
      let selectedProvider: string | null = null;
      let selectedModel: string | null = null;
      let selectedConnectionId: string | null = null;
      let selectionReason = "";

      if (routingStrategy !== "rules") {
        try {
          const decision = selectWithStrategy(
            routableCandidates,
            {
              taskType,
              requestHasTools,
              lastKnownGoodProvider,
              // #11181: the Routing tab persists an LKGP on/off toggle and
              // LKGPStrategy guards on `context.lkgpEnabled === false`, but the
              // field was never forwarded into this context, so the guard never
              // saw the setting and the off-switch was unreachable.
              lkgpEnabled: (settings as { lkgpEnabled?: unknown } | null | undefined)
                ?.lkgpEnabled as boolean | undefined,
              estimatedInputTokens,
              sla: slaPolicy,
              weights,
              explorationRate,
            },
            routingStrategy
          );
          selectedProvider = decision.provider;
          selectedModel = decision.model;
          selectedConnectionId = decision.connectionId ?? null;
          selectionReason = decision.reason;
          autoUsedExplicitRouter = true;
        } catch (err) {
          log.warn(
            "COMBO",
            `Auto strategy '${routingStrategy}' failed (${err?.message || "unknown"}), falling back to rules`
          );
        }
      }

      if (!selectedProvider || !selectedModel) {
        let selection;
        try {
          selection = selectAutoProvider(
            {
              id: combo.id || combo.name,
              name: combo.name,
              type: "auto",
              candidatePool,
              weights,
              modePack,
              budgetCap,
              budgetFallback,
              estimatedInputTokens,
              explorationRate,
            },
            routableCandidates,
            taskType
          );
        } catch (err) {
          // #3470: `budgetFallback: "strict"` refuses to select when every candidate
          // exceeds `budgetCap` — surface a clear cost-exceeds-budget response
          // instead of letting it propagate as an unhandled 500.
          if (err instanceof BudgetExceededError) {
            return { earlyResponse: errorResponse(402, err.message) };
          }
          throw err;
        }
        selectedProvider = selection.provider;
        selectedModel = selection.model;
        selectedConnectionId = selection.connectionId ?? null;
        selectionReason = `score=${selection.score.toFixed(3)}${selection.isExploration ? " (exploration)" : ""}`;
      }

      const rankedTargets = scoredTargets.map((entry) => entry.target);
      const selectedTarget =
        scoredTargets.find((entry) => {
          const parsed = parseModel(entry.target.modelStr);
          const modelId = parsed.model || entry.target.modelStr;
          return (
            entry.target.provider === selectedProvider &&
            modelId === selectedModel &&
            (!selectedConnectionId || entry.target.connectionId === selectedConnectionId)
          );
        })?.target ||
        rankedTargets[0] ||
        eligibleTargets[0];
      if (!selectedTarget) {
        return {
          earlyResponse: unavailableResponse(
            429,
            "No auto strategy targets remained after quota cutoff filtering"
          ),
        };
      }

      // Keep eligibleTargets as the last-resort fallback tail: dedupe drops the
      // routable ranked ones (and, when the cutoff is OFF, makes this identical to
      // the pre-cutoff behavior), but a quota-blocked target still survives as a
      // final fallback instead of vanishing — the hard cutoff only de-prioritizes.
      orderedTargets = dedupeTargetsByExecutionKey(
        [selectedTarget, ...rankedTargets, ...eligibleTargets].filter(
          (entry): entry is ResolvedComboTarget => entry !== undefined && entry !== null
        )
      );

      log.info(
        "COMBO",
        `Auto selection: ${selectedTarget?.modelStr || `${selectedProvider}/${selectedModel}`} | intent=${intent} task=${taskType} | strategy=${routingStrategy} | ${selectionReason}`
      );
    }
  } else {
    log.warn("COMBO", "Auto strategy has no candidates, keeping default ordering");
  }

  return { orderedTargets, autoUsedExplicitRouter };
}
