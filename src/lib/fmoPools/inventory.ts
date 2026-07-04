import { FREE_MODEL_BUDGETS } from "@omniroute/open-sse/config/freeModelCatalog.ts";
import type { FreeModelBudget } from "@omniroute/open-sse/config/freeModelCatalog.ts";
import {
  getAllCustomModels,
  getModelIsHidden,
  getModelCompatOverrides,
  getSyncedAvailableModelsForConnection,
  type ModelCompatOverride,
  type SyncedAvailableModel,
} from "@/lib/db/models";
import { getProviderConnections } from "@/lib/db/providers";
import type { FmoHeadCandidate, FmoPoolTailConfig, JsonRecord } from "./types";
import { readFmoTailProviderConfig } from "./tailConfig";

export interface FmoInventoryDeps {
  getProviderConnections(filter: { isActive: boolean }): Promise<JsonRecord[]>;
  getSyncedAvailableModelsForConnection(
    providerId: string,
    connectionId: string
  ): Promise<SyncedAvailableModel[]>;
  getAllCustomModels?(): Promise<Record<string, unknown>>;
  getModelIsHidden?(providerId: string, modelId: string): boolean;
  getModelCompatOverrides(providerId: string): ModelCompatOverride[];
  freeModelCatalog: FreeModelBudget[];
  readTailConfig(): FmoPoolTailConfig;
}

export const defaultFmoInventoryDeps: FmoInventoryDeps = {
  getProviderConnections,
  getSyncedAvailableModelsForConnection,
  getAllCustomModels,
  getModelIsHidden,
  getModelCompatOverrides,
  freeModelCatalog: FREE_MODEL_BUDGETS,
  readTailConfig: readFmoTailProviderConfig,
};

type InventoryModel = Pick<
  SyncedAvailableModel,
  | "id"
  | "name"
  | "apiFormat"
  | "supportedEndpoints"
  | "inputTokenLimit"
  | "supportsThinking"
  | "supportsVision"
>;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeCustomModels(models: unknown): InventoryModel[] {
  if (!Array.isArray(models)) return [];

  const normalized: InventoryModel[] = [];
  for (const model of models) {
    if (!model || typeof model !== "object" || Array.isArray(model)) continue;
    const record = model as JsonRecord;
    if (record.isHidden === true) continue;

    const id = asString(record.id) ?? asString(record.model);
    if (!id) continue;

    const apiFormat = asString(record.apiFormat);
    const supportedEndpoints = Array.isArray(record.supportedEndpoints)
      ? record.supportedEndpoints
          .map((endpoint) => asString(endpoint))
          .filter((endpoint): endpoint is string => Boolean(endpoint))
      : [];

    normalized.push({
      id,
      name: asString(record.name) ?? asString(record.displayName) ?? id,
      ...(apiFormat ? { apiFormat } : {}),
      ...(supportedEndpoints.length > 0 ? { supportedEndpoints } : {}),
      ...(typeof record.inputTokenLimit === "number"
        ? { inputTokenLimit: record.inputTokenLimit }
        : {}),
      ...(record.supportsThinking === true ? { supportsThinking: true } : {}),
      ...(record.supportsVision === true ? { supportsVision: true } : {}),
    });
  }

  return normalized;
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
  model: InventoryModel,
  override: ModelCompatOverride | undefined
): string[] {
  const caps = new Set<string>();
  for (const endpoint of model.supportedEndpoints ?? []) caps.add(endpoint);
  if (model.apiFormat) caps.add(`api:${model.apiFormat}`);
  if (model.supportsThinking) caps.add("thinking");
  for (const cap of compatCapabilities(override)) caps.add(cap);
  return [...caps].sort();
}

function mergeModelSources(
  syncedModels: SyncedAvailableModel[],
  customModels: InventoryModel[]
): Array<{ model: InventoryModel; source: FmoHeadCandidate["source"] }> {
  const merged = new Map<string, { model: InventoryModel; source: FmoHeadCandidate["source"] }>();

  for (const custom of customModels) {
    merged.set(custom.id, { model: custom, source: "custom" });
  }

  for (const synced of syncedModels) {
    const custom = merged.get(synced.id)?.model;
    merged.set(synced.id, {
      model: {
        ...custom,
        ...synced,
        name: synced.name || custom?.name || synced.id,
        supportedEndpoints: synced.supportedEndpoints ?? custom?.supportedEndpoints,
        apiFormat: synced.apiFormat ?? custom?.apiFormat,
        inputTokenLimit: synced.inputTokenLimit ?? custom?.inputTokenLimit,
        supportsThinking: synced.supportsThinking ?? custom?.supportsThinking,
        supportsVision: synced.supportsVision ?? custom?.supportsVision,
      },
      source: "synced",
    });
  }

  return Array.from(merged.values());
}

export async function buildFmoHeadInventory(
  deps: FmoInventoryDeps = defaultFmoInventoryDeps
): Promise<FmoHeadCandidate[]> {
  const tailProviders = new Set(deps.readTailConfig().providers);
  const connections = await deps.getProviderConnections({ isActive: true });
  const customByProvider = await (deps.getAllCustomModels?.() ?? Promise.resolve({}));
  const isHidden = deps.getModelIsHidden ?? (() => false);
  const candidates: FmoHeadCandidate[] = [];

  for (const connection of connections) {
    const providerId = asString(connection.provider);
    const connectionId = asString(connection.id);
    if (!providerId || !connectionId || tailProviders.has(providerId)) continue;

    const overrides = new Map(
      deps.getModelCompatOverrides(providerId).map((item) => [item.id, item])
    );
    const syncedModels = await deps.getSyncedAvailableModelsForConnection(providerId, connectionId);
    const customModels = normalizeCustomModels(customByProvider[providerId]);
    const models = mergeModelSources(syncedModels, customModels);

    for (const { model, source } of models) {
      if (isHidden(providerId, model.id)) continue;
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
        source,
      });
    }
  }

  return candidates;
}
