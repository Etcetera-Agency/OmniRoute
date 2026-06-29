import { FREE_MODEL_BUDGETS } from "@omniroute/open-sse/config/freeModelCatalog.ts";
import type { FreeModelBudget } from "@omniroute/open-sse/config/freeModelCatalog.ts";
import {
  getModelCompatOverrides,
  getSyncedAvailableModelsForConnection,
  type ModelCompatOverride,
  type SyncedAvailableModel,
} from "@/lib/db/models";
import { getProviderConnections } from "@/lib/db/providers";
import type { FmoHeadCandidate, FmoPoolTailConfig, JsonRecord } from "./types";

export interface FmoInventoryDeps {
  getProviderConnections(filter: { isActive: boolean }): Promise<JsonRecord[]>;
  getSyncedAvailableModelsForConnection(
    providerId: string,
    connectionId: string
  ): Promise<SyncedAvailableModel[]>;
  getModelCompatOverrides(providerId: string): ModelCompatOverride[];
  freeModelCatalog: FreeModelBudget[];
  readTailConfig(): FmoPoolTailConfig;
}

const DEFAULT_TAIL_CONFIG: FmoPoolTailConfig = { providers: [] };

export const defaultFmoInventoryDeps: FmoInventoryDeps = {
  getProviderConnections,
  getSyncedAvailableModelsForConnection,
  getModelCompatOverrides,
  freeModelCatalog: FREE_MODEL_BUDGETS,
  readTailConfig: () => DEFAULT_TAIL_CONFIG,
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function findFreeModel(
  catalog: FreeModelBudget[],
  providerId: string,
  modelId: string
): FreeModelBudget | null {
  return (
    catalog.find(
      (entry) =>
        entry.provider === providerId &&
        (entry.modelId === modelId || `${entry.provider}/${entry.modelId}` === modelId)
    ) ?? null
  );
}

function compatCapabilities(override: ModelCompatOverride | undefined): string[] {
  if (!override) return [];
  const caps = new Set<string>();
  if (override.normalizeToolCallId) caps.add("tool_call");
  if (override.preserveOpenAIDeveloperRole) caps.add("developer_role");
  if (override.compatByProtocol) {
    for (const key of Object.keys(override.compatByProtocol)) caps.add(`protocol:${key}`);
  }
  return [...caps].sort();
}

function modelCapabilities(
  model: SyncedAvailableModel,
  override: ModelCompatOverride | undefined
): string[] {
  const caps = new Set<string>();
  for (const endpoint of model.supportedEndpoints ?? []) caps.add(endpoint);
  if (model.apiFormat) caps.add(`api:${model.apiFormat}`);
  if (model.supportsThinking) caps.add("thinking");
  for (const cap of compatCapabilities(override)) caps.add(cap);
  return [...caps].sort();
}

export async function buildFmoHeadInventory(
  deps: FmoInventoryDeps = defaultFmoInventoryDeps
): Promise<FmoHeadCandidate[]> {
  const tailProviders = new Set(deps.readTailConfig().providers);
  const connections = await deps.getProviderConnections({ isActive: true });
  const candidates: FmoHeadCandidate[] = [];

  for (const connection of connections) {
    const providerId = asString(connection.provider);
    const connectionId = asString(connection.id);
    if (!providerId || !connectionId || tailProviders.has(providerId)) continue;

    const overrides = new Map(
      deps.getModelCompatOverrides(providerId).map((item) => [item.id, item])
    );
    const models = await deps.getSyncedAvailableModelsForConnection(providerId, connectionId);

    for (const model of models) {
      const override = overrides.get(model.id);
      candidates.push({
        providerId,
        connectionId,
        connection,
        modelId: model.id,
        displayName: model.name,
        capabilities: modelCapabilities(model, override),
        contextWindow: model.inputTokenLimit ?? null,
        freeModel: findFreeModel(deps.freeModelCatalog, providerId, model.id),
        source: "synced",
      });
    }
  }

  return candidates;
}
