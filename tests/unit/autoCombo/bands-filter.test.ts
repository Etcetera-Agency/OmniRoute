import { describe, expect, it, vi } from "vitest";
import { createQualityBandCheck } from "../../../open-sse/services/autoCombo/bands/filter";

const candidate = { provider: "provider-a", model: "model-a" };

function makeDependencies(
  fitness: (model: string, taskType: string, profile?: string) => { score: number; source: string },
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

    expect(generalDeps.getTaskFitnessWithSource).toHaveBeenCalledWith(
      "model-a",
      "default",
      "medium"
    );
    expect(codingDeps.getTaskFitnessWithSource).toHaveBeenCalledWith("model-a", "coding", "medium");
  });

  it.each([
    ["low", "low"],
    ["mid", "medium"],
    ["high", "high"],
  ] as const)("passes the %s calculation profile for its band", (band, profile) => {
    const dependencies = makeDependencies(() => ({
      score: 0.75,
      source: "benchmark_consensus:high",
    }));
    createQualityBandCheck("coding", band, {
      ...dependencies,
      allowBenchmarkConsensus: true,
    })(candidate);
    expect(dependencies.getTaskFitnessWithSource).toHaveBeenCalledWith(
      "model-a",
      "coding",
      profile
    );
  });

  it("admits unrated models only to low without applying their score", () => {
    const lowDeps = makeDependencies(() => ({ score: 0.99, source: "wildcard_boost" }));
    const midDeps = makeDependencies(() => ({ score: 0.5, source: "wildcard_boost" }));
    const highDeps = makeDependencies(() => ({ score: 0.9, source: "wildcard_boost" }));

    expect(createQualityBandCheck("general", "low", lowDeps)(candidate)).toBe(true);
    expect(createQualityBandCheck("general", "mid", midDeps)(candidate)).toBe(false);
    expect(createQualityBandCheck("general", "high", highDeps)(candidate)).toBe(false);
  });

  it.each(["fitness_table", "models_dev_tier_extra"])(
    "treats %s scores as unrated outside low",
    (source) => {
      const dependencies = makeDependencies(() => ({ score: 0.75, source }));
      expect(createQualityBandCheck("coding", "high", dependencies)(candidate)).toBe(false);
    }
  );

  it("does not admit lookalike models.dev sources with free opt-in", () => {
    const dependencies = makeDependencies(
      () => ({ score: 0.75, source: "models_dev_tier_extra" }),
      ["models_dev_tier"]
    );
    expect(
      createQualityBandCheck("coding", "high", {
        ...dependencies,
        allowModelsDevTier: true,
      })(candidate)
    ).toBe(false);
  });

  it.each(["models_dev_tier", "models_dev_tier:inherited"])(
    "uses configured ranges for free %s fitness across tasks and bands",
    (source) => {
      for (const task of ["general", "coding"] as const) {
        for (const band of ["low", "mid", "high"] as const) {
          const dependencies = makeDependencies(() => ({ score: 0.75, source }));
          const inRange = band !== "low";
          expect(
            createQualityBandCheck(task, band, { ...dependencies, allowModelsDevTier: true })(
              candidate
            )
          ).toBe(inRange);
        }
      }
    }
  );

  it.each([
    ["paid coding high", "coding", "high"],
    ["paid general mid", "general", "mid"],
  ] as const)("keeps models.dev tier unrated for %s", (_name, task, band) => {
    const dependencies = makeDependencies(() => ({ score: 0.75, source: "models_dev_tier" }));
    expect(createQualityBandCheck(task, band, dependencies)(candidate)).toBe(false);
  });

  it("keeps unrated models available in low without applying their score", () => {
    const dependencies = makeDependencies(() => ({ score: 0.99, source: "models_dev_tier" }));
    expect(createQualityBandCheck("coding", "low", dependencies)(candidate)).toBe(true);
  });

  it("treats inherited Arena fitness as rated", () => {
    const dependencies = makeDependencies(() => ({ score: 0.75, source: "arena_elo:inherited" }));

    expect(createQualityBandCheck("coding", "high", dependencies)(candidate)).toBe(true);
  });

  it("requires the explicit free-band opt-in even when configured as rated", () => {
    const dependencies = makeDependencies(
      () => ({ score: 0.75, source: "models_dev_tier:inherited" }),
      ["models_dev_tier"]
    );

    expect(createQualityBandCheck("coding", "high", dependencies)(candidate)).toBe(false);
    expect(
      createQualityBandCheck("coding", "high", {
        ...dependencies,
        allowModelsDevTier: true,
      })(candidate)
    ).toBe(true);
  });

  it("rates benchmark consensus only for an explicit free-band request", () => {
    const dependencies = makeDependencies(
      () => ({
        score: 0.75,
        source: "benchmark_consensus:high",
      }),
      ["benchmark_consensus"]
    );
    expect(createQualityBandCheck("coding", "high", dependencies)(candidate)).toBe(false);
    expect(
      createQualityBandCheck("coding", "high", {
        ...dependencies,
        allowBenchmarkConsensus: true,
      })(candidate)
    ).toBe(true);
  });

  it("rates benchmark fitness only for an explicit free-band request", () => {
    const dependencies = makeDependencies(() => ({
      score: 0.75,
      source: "benchmark_fitness",
    }));

    expect(createQualityBandCheck("coding", "high", dependencies)(candidate)).toBe(false);
    expect(
      createQualityBandCheck("coding", "high", {
        ...dependencies,
        allowBenchmarkFitness: true,
      })(candidate)
    ).toBe(true);
    expect(createQualityBandCheck("coding", "low", dependencies)(candidate)).toBe(true);
  });

  it("does not admit lookalike benchmark fitness sources", () => {
    const dependencies = makeDependencies(
      () => ({ score: 0.75, source: "benchmark_fitness_extra" }),
      ["benchmark_fitness"]
    );

    expect(
      createQualityBandCheck("coding", "high", {
        ...dependencies,
        allowBenchmarkFitness: true,
      })(candidate)
    ).toBe(false);
  });

  it("rejects a candidate when fitness resolution throws", () => {
    const dependencies = makeDependencies(() => {
      throw new Error("fitness lookup failed");
    });
    const check = createQualityBandCheck("general", "low", dependencies);

    expect(check(candidate)).toBe(false);
  });
});
