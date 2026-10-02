import { describe, expect, it, vi } from "vitest";
import { createQualityBandCheck } from "../../../open-sse/services/autoCombo/bands/filter";

const candidate = { provider: "provider-a", model: "model-a" };

function makeDependencies(
  fitness: (model: string, taskType: string) => { score: number; source: string },
  ratedSources = ["user_override", "arena_elo"]
) {
  return {
    getBandRange: vi.fn((_task: string, band: string) => {
      if (band === "low") return { min: 0, max: 0.55 };
      if (band === "mid") return { min: 0.45, max: 0.8 };
      return { min: 0.7, max: 1 };
    }),
    getRatedSources: () => ratedSources,
    getTaskFitnessWithSource: vi.fn(fitness),
  };
}

describe("quality band filter", () => {
  it("accepts inclusive range boundaries and rejects scores outside the range", () => {
    for (const [score, expected] of [
      [0.45, true],
      [0.8, true],
      [0.449, false],
      [0.801, false],
    ] as const) {
      const dependencies = makeDependencies(() => ({ score, source: "arena_elo" }));
      const check = createQualityBandCheck("general", "mid", dependencies);
      expect(check(candidate)).toBe(expected);
    }
  });

  it("maps general to default and coding to coding fitness", () => {
    const generalDeps = makeDependencies(() => ({ score: 0.5, source: "arena_elo" }));
    const codingDeps = makeDependencies(() => ({ score: 0.5, source: "arena_elo" }));

    createQualityBandCheck("general", "mid", generalDeps)(candidate);
    createQualityBandCheck("coding", "mid", codingDeps)(candidate);

    expect(generalDeps.getTaskFitnessWithSource).toHaveBeenCalledWith("model-a", "default");
    expect(codingDeps.getTaskFitnessWithSource).toHaveBeenCalledWith("model-a", "coding");
  });

  it("admits unrated models only to low without applying their score", () => {
    const lowDeps = makeDependencies(() => ({ score: 0.99, source: "wildcard_boost" }));
    const midDeps = makeDependencies(() => ({ score: 0.5, source: "wildcard_boost" }));
    const highDeps = makeDependencies(() => ({ score: 0.9, source: "wildcard_boost" }));

    expect(createQualityBandCheck("general", "low", lowDeps)(candidate)).toBe(true);
    expect(createQualityBandCheck("general", "mid", midDeps)(candidate)).toBe(false);
    expect(createQualityBandCheck("general", "high", highDeps)(candidate)).toBe(false);
  });

  it.each(["models_dev_tier", "fitness_table"])("treats %s fitness as unrated", (source) => {
    const dependencies = makeDependencies(() => ({ score: 0.75, source }));
    expect(createQualityBandCheck("coding", "mid", dependencies)(candidate)).toBe(false);
  });

  it("treats inherited Arena fitness as rated", () => {
    const dependencies = makeDependencies(() => ({ score: 0.75, source: "arena_elo:inherited" }));

    expect(createQualityBandCheck("coding", "high", dependencies)(candidate)).toBe(true);
  });

  it("uses configured rated source prefixes", () => {
    const dependencies = makeDependencies(
      () => ({ score: 0.75, source: "models_dev_tier:inherited" }),
      ["models_dev_tier"]
    );

    expect(createQualityBandCheck("coding", "high", dependencies)(candidate)).toBe(true);
  });

  it("rejects a candidate when fitness resolution throws", () => {
    const dependencies = makeDependencies(() => {
      throw new Error("fitness lookup failed");
    });
    const check = createQualityBandCheck("general", "low", dependencies);

    expect(check(candidate)).toBe(false);
  });
});
