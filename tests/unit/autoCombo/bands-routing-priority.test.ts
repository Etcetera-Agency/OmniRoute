import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildBandBillingPriority,
  orderBandPoolByThriftyRung,
  type BandBillingPriority,
  type BandThriftyRung,
} from "../../../open-sse/services/autoCombo/bands";
import { DEFAULT_WEIGHTS } from "../../../open-sse/services/autoCombo/scoring";
import { resolveAutoStrategyOrder } from "../../../open-sse/services/combo/resolveAutoStrategy";
import { clearLKGP, getLKGP, setLKGP } from "../../../src/lib/db/settings/lkgp";
import { resetDbInstance } from "../../../src/lib/db/core";

type BandRung = BandThriftyRung;

const lkgpKeys: Array<{ comboName: string; comboId: string }> = [];
let originalBandsFlag: string | undefined;
let lastAutoSelectionMessage = "";

const testLog = {
  info(_scope: string, message: string) {
    if (message.startsWith("Auto selection:")) lastAutoSelectionMessage = message;
  },
  warn() {},
  error() {},
  debug() {},
} as never;

afterEach(async () => {
  if (originalBandsFlag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = originalBandsFlag;
  originalBandsFlag = undefined;
  for (const { comboName, comboId } of lkgpKeys.splice(0)) {
    await clearLKGP(comboName, comboId);
  }
  resetDbInstance();
});

beforeEach(() => {
  lastAutoSelectionMessage = "";
  originalBandsFlag = process.env.OMNIROUTE_AUTO_BANDS;
  process.env.OMNIROUTE_AUTO_BANDS = "1";
});

function makeTarget(
  rung: BandRung,
  provider: string,
  model: string,
  connectionId: string | null = `${provider}-connection`
) {
  return {
    id: `${rung}-${provider}`,
    rung,
    connectionId,
    allowedConnectionIds: connectionId ? [connectionId] : [],
    kind: "model" as const,
    stepId: `${rung}-${provider}`,
    executionKey: `${provider}>${model}@${connectionId}`,
    model,
    modelStr: model,
    provider,
    providerId: provider,
    weight: 1,
    label: provider,
  };
}

function makeCandidate(target: ReturnType<typeof makeTarget>, quotaCutoffBlocked = false) {
  const quality = target.rung === "premium" ? 1 : 0;
  return {
    kind: "model" as const,
    stepId: target.stepId,
    executionKey: target.executionKey,
    modelStr: target.modelStr,
    provider: target.provider,
    model: target.modelStr,
    connectionId: target.connectionId || undefined,
    quotaRemaining: 100,
    quotaTotal: 100,
    circuitBreakerState: "CLOSED" as const,
    costPer1MTokens: target.rung === "premium" ? 100 : 0,
    p95LatencyMs: 100,
    latencyStdDev: 1,
    errorRate: 0,
    quality,
    quotaCutoffBlocked,
  };
}

function makeQualityWeights() {
  return {
    ...DEFAULT_WEIGHTS,
    quota: 0,
    health: 0,
    costInv: 0,
    latencyInv: 0,
    taskFit: 0,
    stability: 0,
    tierPriority: 0,
    tierAffinity: 0,
    specificityMatch: 0,
    contextAffinity: 0,
    cacheAffinity: 0,
    sessionAvailability: 0,
    resetWindowAffinity: 0,
    connectionDensity: 0,
    quality: 1,
    reliability: 0,
  };
}

async function resolveRoutedBandTargets(
  routerStrategy: "lkgp" | "score",
  additionalTargets: ReturnType<typeof makeTarget>[] = [],
  lastKnownGoodProvider = "premium-provider",
  fanoutAllowedAccounts = false,
  quotaCutoffBlockedProviders: string[] = []
) {
  const pool = [
    makeTarget("premium", "premium-provider", "premium-model"),
    makeTarget("free", "free-provider", "free-model"),
    ...additionalTargets,
  ];
  const rungByConnection = new Map<string, BandRung>(
    pool.flatMap((target) =>
      (target.allowedConnectionIds ?? (target.connectionId ? [target.connectionId] : [])).map(
        (connectionId) => [connectionId, target.rung]
      )
    )
  );
  const orderedBandPool = orderBandPoolByThriftyRung(
    pool,
    "general_mid",
    "thrifty",
    (_candidate, connectionId) => rungByConnection.get(connectionId)!
  );
  const comboName = `Auto band priority ${routerStrategy}`;
  const comboId = `auto-band-priority-${routerStrategy}`;
  lkgpKeys.push({ comboName, comboId });
  const activeBandsFlag = process.env.OMNIROUTE_AUTO_BANDS;
  let bandBillingPriority: BandBillingPriority | null = null;
  try {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    bandBillingPriority = buildBandBillingPriority(
      orderedBandPool,
      "general_mid",
      "thrifty",
      (_candidate, connectionId) => rungByConnection.get(connectionId)!
    );
  } finally {
    if (activeBandsFlag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
    else process.env.OMNIROUTE_AUTO_BANDS = activeBandsFlag;
  }
  if (!bandBillingPriority) throw new Error("Expected enabled band billing priority metadata");
  if (additionalTargets.some((target) => target.provider === "multi-provider")) {
    expect(bandBillingPriority.assignments).toContainEqual({
      provider: "multi-provider",
      model: "multi-model",
      connectionId: "allowed-account-B",
      rung: "free",
    });
    expect(bandBillingPriority.assignments).not.toContainEqual(
      expect.objectContaining({ provider: "multi-provider", connectionId: "stale-account-A" })
    );
  }

  if (routerStrategy === "lkgp") {
    await setLKGP(comboName, comboId, lastKnownGoodProvider);
    const stored = await getLKGP(comboName, comboId);
    if (stored?.provider !== lastKnownGoodProvider) {
      throw new Error(`Expected LKGP ${lastKnownGoodProvider}, got ${stored?.provider ?? "none"}`);
    }
  }

  const result = await resolveAutoStrategyOrder({
    orderedTargets: orderedBandPool as never,
    body: { messages: [] },
    combo: {
      id: comboId,
      name: comboName,
      config: {
        auto: {
          candidatePool: Array.from(new Set(orderedBandPool.map((target) => target.provider))),
          routerStrategy,
          weights: makeQualityWeights(),
          explorationRate: 0,
          bandBillingPriority,
        },
      },
    } as never,
    settings: null,
    config: {},
    relayOptions: null,
    resilienceSettings: { quotaPreflight: { enabled: false } } as never,
    log: testLog as never,
    // Keep the production selector/caller path real; inject only the expensive
    // candidate-building dependency that resolveAutoStrategyOrder explicitly owns.
    buildAutoCandidates: async () =>
      orderedBandPool.flatMap((target) => {
        const connectionIds = fanoutAllowedAccounts
          ? (target.allowedConnectionIds ?? (target.connectionId ? [target.connectionId] : []))
          : [target.connectionId];
        return connectionIds.map((connectionId) =>
          makeCandidate(
            {
              ...target,
              connectionId,
              executionKey: `${target.provider}>${target.modelStr}@${connectionId}`,
            },
            quotaCutoffBlockedProviders.includes(target.provider)
          )
        );
      }) as never,
  } as never);

  if (!("orderedTargets" in result)) {
    throw new Error("Auto strategy returned early instead of ordering its candidates");
  }
  return result.orderedTargets;
}

describe("band billing priority through the auto strategy selector", () => {
  it("keeps free ahead of a premium LKGP pin while retaining premium as fallback", async () => {
    const orderedTargets = await resolveRoutedBandTargets("lkgp");

    expect(orderedTargets.map((target) => target.provider)).toEqual([
      "free-provider",
      "premium-provider",
    ]);
  });

  it("keeps free ahead of a higher-scoring premium model and retains premium as fallback", async () => {
    const orderedTargets = await resolveRoutedBandTargets("score");

    expect(orderedTargets.map((target) => target.provider)).toEqual([
      "free-provider",
      "premium-provider",
    ]);
  });

  it("keeps a quota-cutoff-blocked free account only as the final fallback", async () => {
    const orderedTargets = await resolveRoutedBandTargets("score", [], "premium-provider", false, [
      "free-provider",
    ]);

    expect(orderedTargets.map((target) => target.provider)).toEqual([
      "premium-provider",
      "free-provider",
    ]);
    expect(orderedTargets.at(-1)?.connectionId).toBe("free-provider-connection");
  });

  it("applies LKGP within the free rung before falling back to other rungs", async () => {
    const orderedTargets = await resolveRoutedBandTargets(
      "lkgp",
      [makeTarget("free", "free-lkgp-provider", "free-lkgp-model")],
      "free-lkgp-provider"
    );

    expect(lastAutoSelectionMessage).toContain(
      "LKGP: using last known good provider free-lkgp-provider"
    );
    expect(orderedTargets.map((target) => target.provider)).toEqual([
      "free-lkgp-provider",
      "free-provider",
      "premium-provider",
    ]);
  });

  it("drops a logical target that did not fan out to an exact account before routing", async () => {
    const unresolved = makeTarget("premium", "stale-provider", "stale-model");
    unresolved.connectionId = null;
    unresolved.allowedConnectionIds = ["stale-account"];

    const orderedTargets = await resolveRoutedBandTargets("score", [unresolved]);

    expect(orderedTargets.map((target) => target.provider)).toEqual([
      "free-provider",
      "premium-provider",
    ]);
    expect(orderedTargets.map((target) => target.provider)).not.toContain("stale-provider");
    expect(orderedTargets.every((target) => target.connectionId !== null)).toBe(true);
  });

  it("keeps an allowlisted account when a stale direct pin conflicts, and never routes the pin", async () => {
    const conflicting = makeTarget("free", "multi-provider", "multi-model", "stale-account-A");
    conflicting.allowedConnectionIds = ["allowed-account-B"];

    const orderedTargets = await resolveRoutedBandTargets(
      "score",
      [conflicting],
      "premium-provider",
      true
    );

    const multiAccountTarget = orderedTargets.find(
      (target) => target.provider === "multi-provider"
    );
    expect(multiAccountTarget?.connectionId).toBe("allowed-account-B");
    expect(orderedTargets.some((target) => target.connectionId === "stale-account-A")).toBe(false);
  });

  it("leaves selector behavior unchanged when the bands flag is off", async () => {
    process.env.OMNIROUTE_AUTO_BANDS = "0";

    const orderedTargets = await resolveRoutedBandTargets("lkgp");

    expect(orderedTargets.map((target) => target.provider)).toEqual([
      "premium-provider",
      "free-provider",
    ]);
  });
});
