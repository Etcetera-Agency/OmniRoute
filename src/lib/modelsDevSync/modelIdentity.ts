import type { ModelsDevData } from "./transform";

export interface ModelsDevModelIdentity {
  id: string;
  name: string;
}

export function extractModelsDevModelIdentities(data: ModelsDevData): ModelsDevModelIdentity[] {
  const identities = new Map<string, ModelsDevModelIdentity>();
  for (const provider of Object.values(data)) {
    if (!provider || typeof provider.models !== "object" || !provider.models) continue;
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (!modelId) continue;
      identities.set(modelId, {
        id: modelId,
        name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : modelId,
      });
    }
  }
  return [...identities.values()];
}
