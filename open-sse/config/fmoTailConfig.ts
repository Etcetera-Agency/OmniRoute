export const FMO_TAIL_CONFIG = {
  providers: ["openrouter-free"],
  entries: [
    {
      providerId: "openrouter-free",
      modelId: "openrouter/auto:free",
      capabilities: ["api:openai", "chat"],
      contextWindow: 128_000,
    },
  ],
} as const;
