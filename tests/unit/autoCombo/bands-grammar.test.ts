import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseBandId } from "../../../open-sse/services/autoCombo/bands/grammar";

describe("auto quality band channel grammar", () => {
  it("parses each supported task and band", () => {
    assert.deepEqual(parseBandId("general_low"), {
      task: "general",
      band: "low",
      capabilities: [],
    });
    assert.deepEqual(parseBandId("general_mid"), {
      task: "general",
      band: "mid",
      capabilities: [],
    });
    assert.deepEqual(parseBandId("general_high"), {
      task: "general",
      band: "high",
      capabilities: [],
    });
    assert.deepEqual(parseBandId("coding_low"), {
      task: "coding",
      band: "low",
      capabilities: [],
    });
  });

  it("accepts capabilities in any order as the same set", () => {
    const toolsThenSo = parseBandId("general_low_tools_so");
    const soThenTools = parseBandId("general_low_so_tools");

    assert.deepEqual(toolsThenSo, soThenTools);
    assert.deepEqual(new Set(toolsThenSo?.capabilities), new Set(["tools", "so"]));
  });

  it("accepts each listed capability once", () => {
    const parsed = parseBandId("coding_high_tools_so_reasoning_vision");

    assert.deepEqual(
      new Set(parsed?.capabilities),
      new Set(["tools", "so", "reasoning", "vision"])
    );
  });

  it("rejects duplicate, unknown, or empty segments", () => {
    for (const suffix of [
      "general_low_tools_tools",
      "general_low_unknown",
      "general_ultra",
      "unknown_low",
      "general_low_",
      "general__low",
      "general_low_tools_extra",
    ]) {
      assert.equal(parseBandId(suffix), null, suffix);
    }
  });
});
