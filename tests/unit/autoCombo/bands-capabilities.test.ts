import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { ResolvedModelCapabilities } from "@/lib/modelCapabilities";
import { buildCapabilityCheck } from "../../../open-sse/services/autoCombo/bands/capabilities";

const { resolveCapabilities } = vi.hoisted(() => ({
  resolveCapabilities: vi.fn(),
}));

vi.mock("@/lib/modelCapabilities", () => ({
  getResolvedModelCapabilities: resolveCapabilities,
}));

const candidate = { provider: "test-provider", model: "test-model" };

function resolved(values: Partial<ResolvedModelCapabilities> = {}): ResolvedModelCapabilities {
  return {
    provider: candidate.provider,
    model: candidate.model,
    rawModel: candidate.model,
    toolCalling: false,
    reasoning: false,
    supportsThinking: false,
    supportedThinkingEfforts: null,
    reasoningEffortsOverride: false,
    supportsTools: false,
    supportsVision: false,
    supportsAudio: null,
    supportsVideo: null,
    supportsMaxTokens: false,
    attachment: null,
    structuredOutput: null,
    temperature: null,
    contextWindow: 0,
    maxInputTokens: null,
    maxOutputTokens: null,
    defaultThinkingBudget: 0,
    thinkingBudgetCap: null,
    thinkingOverhead: null,
    adaptiveMaxTokens: null,
    family: null,
    status: null,
    openWeights: null,
    knowledgeCutoff: null,
    releaseDate: null,
    lastUpdated: null,
    modalitiesInput: [],
    modalitiesOutput: [],
    interleavedField: null,
    ...values,
  };
}

afterEach(() => {
  resolveCapabilities.mockReset();
});

describe("auto quality band capability checks", () => {
  it("keeps native tool-calling models and drops incompatible models", () => {
    resolveCapabilities.mockReturnValueOnce(resolved({ toolCalling: true, supportsTools: null }));
    resolveCapabilities.mockReturnValueOnce(resolved({ toolCalling: true, supportsTools: false }));
    resolveCapabilities.mockReturnValueOnce(resolved({ toolCalling: false, supportsTools: true }));

    const check = buildCapabilityCheck(["tools"]);

    assert.equal(check(candidate), true);
    assert.equal(check(candidate), false);
    assert.equal(check(candidate), false);
  });

  it("keeps providers whose upstream tool support is emulated", () => {
    resolveCapabilities.mockReturnValue(resolved({ toolCalling: false, supportsTools: false }));

    const check = buildCapabilityCheck(["tools"]);

    assert.equal(check({ provider: "gemini-web", model: "gemini-2.5-pro" }), true);
  });

  it("allows structured output true, rejects false, and denies unknown by default", () => {
    resolveCapabilities.mockReturnValueOnce(resolved({ structuredOutput: true }));
    resolveCapabilities.mockReturnValueOnce(resolved({ structuredOutput: false }));
    resolveCapabilities.mockReturnValueOnce(resolved({ structuredOutput: null }));

    const check = buildCapabilityCheck(["so"]);

    assert.equal(check(candidate), true);
    assert.equal(check(candidate), false);
    assert.equal(check(candidate), false);
  });

  it("can allow unknown structured-output capability from config", () => {
    resolveCapabilities
      .mockReturnValueOnce(resolved({ structuredOutput: null }))
      .mockReturnValueOnce(resolved({ structuredOutput: false }));

    const check = buildCapabilityCheck(["so"], "allow");

    assert.equal(check(candidate), true);
    assert.equal(check(candidate), false);
  });

  it("accepts either reasoning or thinking support", () => {
    resolveCapabilities.mockReturnValueOnce(resolved({ reasoning: true }));
    resolveCapabilities.mockReturnValueOnce(resolved({ supportsThinking: true }));
    resolveCapabilities.mockReturnValueOnce(resolved());

    const check = buildCapabilityCheck(["reasoning"]);

    assert.equal(check(candidate), true);
    assert.equal(check(candidate), true);
    assert.equal(check(candidate), false);
  });

  it("requires affirmative native vision support and rejects bridge-forced models", () => {
    resolveCapabilities.mockReturnValueOnce(resolved({ supportsVision: true }));
    resolveCapabilities.mockReturnValueOnce(resolved({ supportsVision: null }));
    resolveCapabilities.mockReturnValueOnce(resolved({ supportsVision: true }));

    const check = buildCapabilityCheck(["vision"]);

    assert.equal(check(candidate), true);
    assert.equal(check(candidate), false);
    assert.equal(check({ provider: "opencode-go", model: "deepseek-v4-flash" }), false);
  });

  it("ANDs channel capabilities without depending on request-body fields", () => {
    resolveCapabilities.mockReturnValueOnce(
      resolved({ toolCalling: true, supportsTools: true, reasoning: true })
    );
    resolveCapabilities.mockReturnValueOnce(
      resolved({ toolCalling: true, supportsTools: true, reasoning: false })
    );

    const check = buildCapabilityCheck(["tools", "reasoning"]);

    assert.equal(check(candidate), true);
    assert.equal(check(candidate), false);
  });

  it("passes candidates unchanged when a channel has no capability suffix", () => {
    const check = buildCapabilityCheck([]);

    assert.equal(check(candidate), true);
    assert.equal(resolveCapabilities.mock.calls.length, 0);
  });
});
