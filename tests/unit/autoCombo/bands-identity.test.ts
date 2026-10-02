import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { classifyTier } from "../../../open-sse/services/tierResolver";
import {
  buildAutoCandidateFilter,
  parseAutoSuffix,
} from "../../../open-sse/services/autoCombo/suffixComposition";

const nativeSuffixes = [
  ["coding", { valid: true, category: "coding" }],
  ["coding:fast", { valid: true, category: "coding", tier: "fast" }],
  ["vision", { valid: true, category: "vision" }],
  ["reasoning:pro", { valid: true, category: "reasoning", tier: "pro" }],
  ["bogus", { valid: false }],
  ["coding:bogus", { valid: false }],
  ["a:b:c", { valid: false }],
] as const;
const originalBandsFlag = process.env.OMNIROUTE_AUTO_BANDS;

afterEach(() => {
  if (originalBandsFlag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = originalBandsFlag;
});

describe("auto quality bands preserve upstream suffix identity", () => {
  it.each([undefined, "1"] as const)("preserves native parsing with bands flag %s", (flag) => {
    if (flag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
    else process.env.OMNIROUTE_AUTO_BANDS = flag;

    for (const [suffix, expected] of nativeSuffixes) {
      assert.deepEqual(parseAutoSuffix(suffix), expected, suffix);
    }
  });

  it("keeps native category filters and model-tier decisions", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";

    const coding = buildAutoCandidateFilter("coding");
    const codingFast = buildAutoCandidateFilter("coding", "fast");
    assert.equal(coding, null);
    assert.equal(codingFast, null);

    const vision = buildAutoCandidateFilter("vision");
    assert.ok(vision);
    assert.equal(vision({ provider: "test", model: "text", resolvedSupportsVision: true }), true);
    assert.equal(vision({ provider: "test", model: "text", resolvedSupportsVision: false }), false);

    const reasoningPro = buildAutoCandidateFilter("reasoning", "pro");
    assert.ok(reasoningPro);
    assert.equal(
      reasoningPro({
        provider: "openai",
        model: "gpt-4o",
        resolvedReasoning: false,
        resolvedSupportsThinking: false,
      }),
      false
    );

    const reasoningCandidate = {
      provider: "openai",
      model: "gpt-4o",
      resolvedReasoning: true,
      resolvedSupportsThinking: false,
    };
    assert.equal(
      reasoningPro(reasoningCandidate),
      classifyTier(reasoningCandidate.provider, reasoningCandidate.model).tier === "premium"
    );
  });
});
