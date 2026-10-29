import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderNodeSchema,
  providerNodeValidateSchema,
  updateProviderNodeSchema,
} from "@/shared/validation/schemas/provider";
import { validateProviderNodeModelsPath } from "@/app/api/provider-nodes/urlGuard";

test("compatible model endpoint schemas accept slash paths and HTTP(S) URLs", () => {
  const modelsPaths = ["/custom/models", "https://gateway.example/v1/custom/models", ""];

  for (const modelsPath of modelsPaths) {
    assert.equal(
      createProviderNodeSchema.safeParse({
        name: "Gateway",
        prefix: "gateway",
        apiType: "chat",
        type: "openai-compatible",
        baseUrl: "https://gateway.example/v1",
        modelsPath,
      }).success,
      true
    );
    assert.equal(
      updateProviderNodeSchema.safeParse({
        name: "Gateway",
        prefix: "gateway",
        baseUrl: "https://gateway.example/v1",
        modelsPath,
      }).success,
      true
    );
    assert.equal(
      providerNodeValidateSchema.safeParse({
        type: "anthropic-compatible",
        baseUrl: "https://gateway.example/v1",
        apiKey: "test-key",
        modelsPath,
      }).success,
      true
    );
  }
});

test("compatible model endpoint schemas reject bare relative and non-HTTP URLs", () => {
  for (const modelsPath of ["custom/models", "ftp://gateway.example/models"]) {
    assert.equal(
      createProviderNodeSchema.safeParse({
        name: "Gateway",
        prefix: "gateway",
        apiType: "chat",
        type: "openai-compatible",
        baseUrl: "https://gateway.example/v1",
        modelsPath,
      }).success,
      false
    );
  }
});

test("provider node writes accept same-origin model URLs and reject cross-origin URLs", async () => {
  assert.equal(
    validateProviderNodeModelsPath(
      "https://gateway.example/v1",
      "https://gateway.example/custom/models"
    ),
    null
  );
  const error = validateProviderNodeModelsPath(
    "https://gateway.example/v1",
    "https://other.example/models"
  );
  assert.equal(error?.status, 400);
  assert.deepEqual(await error?.json(), {
    error: {
      message: "Invalid request",
      details: [
        { field: "modelsPath", message: "Compatible models endpoint must use the base URL origin" },
      ],
    },
  });
});
