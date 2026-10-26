import { describe, expect, it } from "vitest";
import { getBenchmarkConsensusFitness } from "../../../open-sse/services/autoCombo/bands/benchmarkConsensusFitness";

describe("benchmark band fitness snapshot", () => {
  it("keeps separate scores for low, medium, and high profiles", () => {
    expect(getBenchmarkConsensusFitness("MIMO-V2.6-FLASH-FREE", "coding", "low")).toBe(
      0.8796875
    );
    expect(getBenchmarkConsensusFitness("mimo-v2.6-flash-free", "coding", "medium")).toBe(
      0.8484375
    );
    expect(getBenchmarkConsensusFitness("mimo-v2.6-flash-free", "coding", "high")).toBe(
      0.8171875
    );
  });

  it("maps general to the general score and leaves missing evidence null", () => {
    expect(getBenchmarkConsensusFitness("mimo-v2.6-flash-free", "default", "high")).toBe(
      getBenchmarkConsensusFitness("mimo-v2.6-flash-free", "general", "high")
    );
    expect(getBenchmarkConsensusFitness("not-in-snapshot", "coding", "high")).toBeNull();
    expect(getBenchmarkConsensusFitness("mimo-v2.6-flash-free", "math", "high")).toBeNull();
  });
});
