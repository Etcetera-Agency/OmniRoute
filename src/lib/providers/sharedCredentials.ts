export const SHARED_CREDENTIAL_PROVIDER_GROUPS = [
  ["parallel-search", "parallel-extract"],
  ["firecrawl", "firecrawl-search"],
  ["jina-ai", "jina-reader"],
  ["perplexity", "perplexity-search"],
  ["ollama-cloud", "ollama-search"],
  ["zai", "zai-search"],
  ["gemini", "gemini-grounded-search"],
] as const;

export function getSharedCredentialProviderIds(providerId: string): string[] {
  const normalized = providerId.trim();
  if (!normalized) return [];

  const group = SHARED_CREDENTIAL_PROVIDER_GROUPS.find((ids) =>
    (ids as readonly string[]).includes(normalized)
  );
  return group ? [...group] : [normalized];
}
