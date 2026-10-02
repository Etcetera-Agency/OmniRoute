import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { orderBandPoolByThriftyRung } from "../../../open-sse/services/autoCombo/bands";
import { parseAutoSuffix } from "../../../open-sse/services/autoCombo/suffixComposition";

const originalBandsFlag = process.env.OMNIROUTE_AUTO_BANDS;

afterEach(() => {
  if (originalBandsFlag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = originalBandsFlag;
});

describe("auto quality band routing seam", () => {
  it("defaults an enabled band channel to thrifty and preserves an explicit tier", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";

    assert.deepEqual(parseAutoSuffix("general_mid"), {
      valid: true,
      category: "general_mid",
      tier: "thrifty",
    });
    assert.deepEqual(parseAutoSuffix("general_mid:free"), {
      valid: true,
      category: "general_mid",
      tier: "free",
    });
  });

  it("degrades disabled band channels to upstream categories without defaulting tier", () => {
    delete process.env.OMNIROUTE_AUTO_BANDS;

    assert.deepEqual(parseAutoSuffix("general_mid"), {
      valid: true,
      category: "chat",
      tier: undefined,
    });
    assert.deepEqual(parseAutoSuffix("coding_high"), {
      valid: true,
      category: "coding",
      tier: undefined,
    });
    assert.deepEqual(parseAutoSuffix("general_low_reasoning:free"), {
      valid: true,
      category: "reasoning",
      tier: "free",
    });
    assert.deepEqual(parseAutoSuffix("coding_low_vision:free"), {
      valid: true,
      category: "vision",
      tier: "free",
    });
  });

  it("leaves ordinary upstream suffixes unchanged", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";

    assert.deepEqual(parseAutoSuffix("coding:free"), {
      valid: true,
      category: "coding",
      tier: "free",
    });
    assert.deepEqual(parseAutoSuffix("chat:thrifty"), {
      valid: true,
      category: "chat",
      tier: "thrifty",
    });
  });

  it("orders only enabled band-thrifty candidates and preserves all candidates", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const rungByConnection = new Map([
      ["premium", "premium"],
      ["subscription", "subscription"],
      ["cheap", "cheap"],
      ["free", "free"],
      ["keyless", "keyless"],
    ] as const);
    const pool = [
      { id: "premium", connectionId: "premium", allowedConnectionIds: undefined },
      { id: "subscription", connectionId: "subscription", allowedConnectionIds: undefined },
      { id: "cheap", connectionId: "cheap", allowedConnectionIds: undefined },
      { id: "free", connectionId: "free", allowedConnectionIds: undefined },
      { id: "keyless", connectionId: "keyless", allowedConnectionIds: undefined },
    ];

    const ordered = orderBandPoolByThriftyRung(
      pool,
      "general_mid",
      "thrifty",
      (_candidate, connectionId) => rungByConnection.get(connectionId)!
    );

    assert.deepEqual(
      ordered.map(({ id }) => id),
      ["free", "keyless", "subscription", "cheap", "premium"]
    );
    assert.equal(new Set(ordered).size, pool.length);
  });

  it("ranks only the candidate's account set after it has been narrowed", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const rungByConnection = new Map([
      ["reserved", "free"],
      ["available", "subscription"],
      ["free", "free"],
    ] as const);
    const pool = [
      {
        id: "account-backed-model",
        connectionId: "reserved",
        allowedConnectionIds: ["available"],
      },
      { id: "free-model", connectionId: null, allowedConnectionIds: ["free"] },
    ];
    const resolvedConnections: string[] = [];

    const ordered = orderBandPoolByThriftyRung(
      pool,
      "general_low",
      "thrifty",
      (_candidate, connectionId) => {
        resolvedConnections.push(connectionId);
        return rungByConnection.get(connectionId)!;
      }
    );

    assert.deepEqual(
      ordered.map(({ id }) => id),
      ["free-model", "account-backed-model"]
    );
    assert.deepEqual(resolvedConnections, ["available", "free"]);
    assert.deepEqual(pool[0].allowedConnectionIds, ["available"]);
  });

  it("leaves non-band, non-thrifty, and disabled pools untouched", () => {
    const pool = [
      { id: "subscription", connectionId: "sub", allowedConnectionIds: undefined },
      { id: "free", connectionId: "free", allowedConnectionIds: undefined },
    ];
    const resolveRung = (_candidate: (typeof pool)[number], id: string) =>
      id === "sub" ? ("subscription" as const) : ("free" as const);

    for (const [category, tier, flag] of [
      ["chat", "thrifty", "1"],
      ["general_mid", "free", "1"],
      ["general_mid", "thrifty", "0"],
    ] as const) {
      process.env.OMNIROUTE_AUTO_BANDS = flag;
      assert.equal(orderBandPoolByThriftyRung(pool, category, tier, resolveRung), pool);
    }
  });
});
