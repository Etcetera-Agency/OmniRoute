import { getDbInstance } from "../db/core.ts";
import { isModelExcludedByConnection } from "../../domain/connectionModelRules";

export interface CompatibleModelRecord {
  id: string;
  name?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  structuredOutput?: boolean;
  inputDollarsPer1M?: number;
  outputDollarsPer1M?: number;
}

export interface CompatibleMetadataSnapshot {
  providerId: string;
  connectionId: string;
  sourceUrl: string;
  fetchedAt: string;
  modelsById: Record<string, CompatibleModelRecord>;
}

export interface CompatibleEligibleConnection {
  providerId: string;
  connectionId: string;
  modelIds: string[];
}

export interface CompatibleMetadataPrices {
  pricingByProvider: Record<string, Record<string, { input: number; output: number }>>;
  zeroPriceModelsByProvider: Record<string, string[]>;
  fetchedAt: string | null;
  zeroFetchedAt: string | null;
}

export type CompatibleBooleanCapability = "supportsVision" | "supportsTools" | "structuredOutput";

export const COMPATIBLE_METADATA_NAMESPACE = "compatible_model_metadata";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonnegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function setOwnValue<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function normalizedRecord(id: string, source: UnknownRecord): CompatibleModelRecord {
  const record: CompatibleModelRecord = { id };
  const name = nonEmptyString(source.display_name) ?? nonEmptyString(source.name);
  if (name) record.name = name;

  const inputTokenLimit = nonnegativeFiniteNumber(source.max_input_tokens);
  const outputTokenLimit = nonnegativeFiniteNumber(source.max_tokens);
  if (inputTokenLimit !== undefined) record.inputTokenLimit = inputTokenLimit;
  if (outputTokenLimit !== undefined) record.outputTokenLimit = outputTokenLimit;

  const capabilities = asRecord(source.capabilities);
  const imageInput = asRecord(capabilities?.image_input);
  if (typeof source.supportsVision === "boolean") {
    record.supportsVision = source.supportsVision;
  } else if (typeof imageInput?.supported === "boolean") {
    record.supportsVision = imageInput.supported;
  }
  if (typeof source.supportsTools === "boolean") {
    record.supportsTools = source.supportsTools;
  }
  if (typeof capabilities?.structured_output === "boolean") {
    record.structuredOutput = capabilities.structured_output;
  }

  const inputDollarsPer1M = nonnegativeFiniteNumber(source.dollarsPer1M);
  const outputDollarsPer1M = nonnegativeFiniteNumber(source.outputDollarsPer1M);
  if (inputDollarsPer1M !== undefined) record.inputDollarsPer1M = inputDollarsPer1M;
  if (outputDollarsPer1M !== undefined) record.outputDollarsPer1M = outputDollarsPer1M;
  return record;
}

export function normalizeCompatibleModels(rawModels: unknown): CompatibleModelRecord[] {
  if (!Array.isArray(rawModels)) throw new Error("Compatible model catalog must be an array");

  const modelsById = new Map<string, CompatibleModelRecord>();
  const duplicateIds = new Set<string>();
  for (const value of rawModels) {
    const source = asRecord(value);
    const id = nonEmptyString(source?.id);
    if (!source || !id) throw new Error("Compatible model catalog contains an invalid model ID");
    if (modelsById.has(id)) duplicateIds.add(id);
    else modelsById.set(id, normalizedRecord(id, source));
  }
  return [...modelsById.values()].filter((model) => !duplicateIds.has(model.id));
}

function parseStoredModel(id: string, value: unknown): CompatibleModelRecord | null {
  const source = asRecord(value);
  if (!source || source.id !== id || id.length === 0) return null;
  const record: CompatibleModelRecord = { id };
  if (source.name !== undefined) {
    if (typeof source.name !== "string" || source.name.length === 0) return null;
    record.name = source.name;
  }
  for (const [stored, field] of [
    ["inputTokenLimit", "inputTokenLimit"],
    ["outputTokenLimit", "outputTokenLimit"],
    ["inputDollarsPer1M", "inputDollarsPer1M"],
    ["outputDollarsPer1M", "outputDollarsPer1M"],
  ] as const) {
    if (source[stored] !== undefined) {
      const number = nonnegativeFiniteNumber(source[stored]);
      if (number === undefined) return null;
      record[field] = number;
    }
  }
  for (const field of ["supportsVision", "supportsTools", "structuredOutput"] as const) {
    if (source[field] !== undefined) {
      if (typeof source[field] !== "boolean") return null;
      record[field] = source[field];
    }
  }
  return record;
}

export function parseCompatibleMetadataSnapshot(value: unknown): CompatibleMetadataSnapshot | null {
  const source = asRecord(value);
  const providerId = nonEmptyString(source?.providerId);
  const connectionId = nonEmptyString(source?.connectionId);
  const sourceUrl = nonEmptyString(source?.sourceUrl);
  const fetchedAt = nonEmptyString(source?.fetchedAt);
  const rawModelsById = asRecord(source?.modelsById);
  if (
    !providerId ||
    !connectionId ||
    !sourceUrl ||
    !fetchedAt ||
    !Number.isFinite(Date.parse(fetchedAt)) ||
    !rawModelsById
  ) {
    return null;
  }

  const modelsById: Record<string, CompatibleModelRecord> = {};
  for (const [id, model] of Object.entries(rawModelsById)) {
    const parsed = parseStoredModel(id, model);
    if (!parsed) return null;
    setOwnValue(modelsById, id, parsed);
  }
  return { providerId, connectionId, sourceUrl, fetchedAt, modelsById };
}

function snapshotKey(providerId: string, connectionId: string): string {
  return JSON.stringify([providerId, connectionId]);
}

export function saveCompatibleMetadataSnapshot(
  providerId: string,
  connectionId: string,
  sourceUrl: string,
  rawModels: unknown,
  fetchedAt = new Date().toISOString()
): CompatibleMetadataSnapshot {
  if (!providerId || !connectionId || !sourceUrl) {
    throw new Error("Compatible metadata snapshot identity is incomplete");
  }
  const models = normalizeCompatibleModels(rawModels);
  const modelsById = Object.fromEntries(models.map((model) => [model.id, model]));
  const snapshot = parseCompatibleMetadataSnapshot({
    providerId,
    connectionId,
    sourceUrl,
    fetchedAt,
    modelsById,
  });
  if (!snapshot) throw new Error("Compatible metadata snapshot is invalid");

  getDbInstance()
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run(
      COMPATIBLE_METADATA_NAMESPACE,
      snapshotKey(providerId, connectionId),
      JSON.stringify(snapshot)
    );
  return snapshot;
}

export function readCompatibleMetadataSnapshot(
  providerId: string,
  connectionId: string
): CompatibleMetadataSnapshot | null {
  const row = getDbInstance()
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(COMPATIBLE_METADATA_NAMESPACE, snapshotKey(providerId, connectionId)) as
    { value?: unknown } | undefined;
  if (typeof row?.value !== "string") return null;
  try {
    const snapshot = parseCompatibleMetadataSnapshot(JSON.parse(row.value));
    return snapshot?.providerId === providerId && snapshot.connectionId === connectionId
      ? snapshot
      : null;
  } catch {
    return null;
  }
}

export function readCompatibleModelMetadata(
  providerId: string,
  connectionId: string,
  rawModelId: string
): CompatibleModelRecord | null {
  const modelsById = readCompatibleMetadataSnapshot(providerId, connectionId)?.modelsById;
  return modelsById && Object.hasOwn(modelsById, rawModelId) ? modelsById[rawModelId] : null;
}

export function readCompatibleMetadataSnapshots(): CompatibleMetadataSnapshot[] {
  const rows = getDbInstance()
    .prepare("SELECT key, value FROM key_value WHERE namespace = ?")
    .all(COMPATIBLE_METADATA_NAMESPACE) as Array<{ key?: unknown; value?: unknown }>;
  return rows.flatMap((row) => {
    if (typeof row.key !== "string" || typeof row.value !== "string") return [];
    try {
      const snapshot = parseCompatibleMetadataSnapshot(JSON.parse(row.value));
      return snapshot && row.key === snapshotKey(snapshot.providerId, snapshot.connectionId)
        ? [snapshot]
        : [];
    } catch {
      return [];
    }
  });
}

export function readCurrentCompatibleEligibleConnections(): CompatibleEligibleConnection[] {
  // AICODE-NOTE: Read only exclusion patterns from connection JSON; never select credentials for capability eligibility.
  const rows = getDbInstance()
    .prepare(
      `SELECT n.id AS provider_id, n.type, c.id AS connection_id, m.value,
         CASE WHEN json_valid(c.provider_specific_data) THEN COALESCE(
           CASE WHEN json_type(c.provider_specific_data, '$.excludedModels') != 'null'
             THEN json_extract(c.provider_specific_data, '$.excludedModels') END,
           json_extract(c.provider_specific_data, '$.excluded_models')
         ) END AS excluded_models,
         CASE WHEN json_valid(c.provider_specific_data) THEN COALESCE(
           CASE WHEN json_type(c.provider_specific_data, '$.excludedModels') != 'null'
             THEN json_type(c.provider_specific_data, '$.excludedModels') END,
           json_type(c.provider_specific_data, '$.excluded_models')
         ) END AS excluded_models_type
       FROM provider_nodes n
       JOIN provider_connections c ON c.provider = n.id AND c.is_active = 1
       JOIN key_value m ON m.namespace = 'syncedAvailableModels'
         AND m.key = n.id || ':' || c.id
       WHERE n.type IN ('openai-compatible', 'anthropic-compatible')
       ORDER BY n.id, c.id`
    )
    .all() as Array<{
    provider_id?: unknown;
    type?: unknown;
    connection_id?: unknown;
    value?: unknown;
    excluded_models?: unknown;
    excluded_models_type?: unknown;
  }>;
  return rows.flatMap((row) => {
    if (
      typeof row.provider_id !== "string" ||
      (row.type !== "openai-compatible" && row.type !== "anthropic-compatible") ||
      typeof row.connection_id !== "string" ||
      typeof row.value !== "string"
    ) {
      return [];
    }
    try {
      const models: unknown = JSON.parse(row.value);
      if (!Array.isArray(models)) return [];
      let excludedModels = row.excluded_models;
      if (row.excluded_models_type === "array" && typeof excludedModels === "string") {
        excludedModels = JSON.parse(excludedModels) as unknown;
      }
      const providerSpecificData = { excludedModels };
      const modelIds: string[] = [];
      for (const model of models) {
        const id = asRecord(model)?.id;
        if (typeof id !== "string" || id.length === 0) return [];
        if (isModelExcludedByConnection(id, providerSpecificData)) continue;
        modelIds.push(id);
      }
      return [{ providerId: row.provider_id, connectionId: row.connection_id, modelIds }];
    } catch {
      return [];
    }
  });
}

export function resolveCompatibleCapabilityOverride(
  snapshots: CompatibleMetadataSnapshot[],
  eligibleConnections: CompatibleEligibleConnection[],
  providerId: string,
  rawModelId: string,
  capability: CompatibleBooleanCapability,
  higherPriorityOverride?: boolean | null
): boolean | null {
  // AICODE-NOTE: Keep compatible declarations exact and current; price TTL never expires them.
  if (typeof higherPriorityOverride === "boolean") return higherPriorityOverride;

  const snapshotsByConnection = new Map(
    snapshots.map((snapshot) => [snapshotKey(snapshot.providerId, snapshot.connectionId), snapshot])
  );
  let foundTrue = false;
  for (const connection of eligibleConnections) {
    if (connection.providerId !== providerId || !connection.modelIds.includes(rawModelId)) continue;
    const snapshot = snapshotsByConnection.get(snapshotKey(providerId, connection.connectionId));
    if (!snapshot || !Object.hasOwn(snapshot.modelsById, rawModelId)) continue;
    const value = snapshot.modelsById[rawModelId][capability];
    if (value === false) return false;
    if (value === true) foundTrue = true;
  }
  return foundTrue ? true : null;
}

function hasValidTimestamp(fetchedAt: string, now: number): boolean {
  const timestamp = Date.parse(fetchedAt);
  return Number.isFinite(timestamp) && timestamp <= now;
}

export function composeCompatibleMetadataPrices(
  snapshots: CompatibleMetadataSnapshot[],
  eligibleConnections: CompatibleEligibleConnection[],
  now = Date.now()
): CompatibleMetadataPrices {
  // AICODE-NOTE: Compatible prices require complete exact-price agreement across all active eligible connections.
  const validSnapshots = new Map(
    snapshots
      .filter((snapshot) => hasValidTimestamp(snapshot.fetchedAt, now))
      .map((snapshot) => [snapshotKey(snapshot.providerId, snapshot.connectionId), snapshot])
  );
  const connectionsByModel = new Map<string, CompatibleEligibleConnection[]>();
  for (const connection of eligibleConnections) {
    for (const modelId of new Set(connection.modelIds)) {
      const key = JSON.stringify([connection.providerId, modelId]);
      const connections = connectionsByModel.get(key) ?? [];
      connections.push(connection);
      connectionsByModel.set(key, connections);
    }
  }

  const pricingByProvider: CompatibleMetadataPrices["pricingByProvider"] = {};
  const zeroPriceModelsByProvider: CompatibleMetadataPrices["zeroPriceModelsByProvider"] = {};
  let oldestPriceTime = Number.POSITIVE_INFINITY;
  let oldestZeroTime = Number.POSITIVE_INFINITY;
  for (const [key, connections] of connectionsByModel) {
    const [providerId, modelId] = JSON.parse(key) as [string, string];
    const prices = connections.map((connection) => {
      const snapshot = validSnapshots.get(
        snapshotKey(connection.providerId, connection.connectionId)
      );
      if (!snapshot || !Object.hasOwn(snapshot.modelsById, modelId)) return null;
      const model = snapshot.modelsById[modelId];
      if (model.inputDollarsPer1M === undefined || model.outputDollarsPer1M === undefined) {
        return null;
      }
      return { snapshot, input: model.inputDollarsPer1M, output: model.outputDollarsPer1M };
    });
    const completePrices = prices.filter(
      (price): price is NonNullable<typeof price> => price !== null
    );
    if (completePrices.length !== connections.length || completePrices.length === 0) continue;
    const first = completePrices[0];
    if (
      completePrices.some((price) => price.input !== first.input || price.output !== first.output)
    ) {
      continue;
    }

    const modelPricing = Object.hasOwn(pricingByProvider, providerId)
      ? pricingByProvider[providerId]
      : {};
    setOwnValue(pricingByProvider, providerId, modelPricing);
    setOwnValue(modelPricing, modelId, {
      input: first.input,
      output: first.output,
    });
    for (const price of completePrices) {
      oldestPriceTime = Math.min(oldestPriceTime, Date.parse(price.snapshot.fetchedAt));
    }
    if (first.input === 0 && first.output === 0) {
      const zeroModels = Object.hasOwn(zeroPriceModelsByProvider, providerId)
        ? zeroPriceModelsByProvider[providerId]
        : [];
      setOwnValue(zeroPriceModelsByProvider, providerId, zeroModels);
      zeroModels.push(modelId);
      for (const price of completePrices) {
        oldestZeroTime = Math.min(oldestZeroTime, Date.parse(price.snapshot.fetchedAt));
      }
    }
  }

  return {
    pricingByProvider,
    zeroPriceModelsByProvider,
    fetchedAt: Number.isFinite(oldestPriceTime) ? new Date(oldestPriceTime).toISOString() : null,
    zeroFetchedAt: Number.isFinite(oldestZeroTime) ? new Date(oldestZeroTime).toISOString() : null,
  };
}
