export const APINEX_PUBLIC_MODELS_URL = "https://apinex.bond/api/public/models";

const APINEX_BASE_URL = "https://api.apinex.bond/v1";
const ZERO_PRICE_EVIDENCE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

export interface ApinexCatalogNode {
  id: string;
  type: string;
  baseUrl: string;
  availableModelIds: string[];
}

export interface ApinexZeroPriceEvidence {
  sourceUrl: string;
  fetchedAt: string;
  modelsByProvider: Record<string, string[]>;
}

interface ZeroPriceSnapshot {
  fetchedAt: string;
  modelsByProvider: Record<string, string[]>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasValidModelMap(value: unknown): value is Record<string, string[]> {
  const record = asRecord(value);
  return (
    record !== null &&
    Object.entries(record).every(
      ([provider, models]) =>
        provider.length > 0 &&
        Array.isArray(models) &&
        models.every((model) => typeof model === "string" && model.length > 0)
    )
  );
}

/** Parse APInex's public structured catalog; malformed catalogs fail as a whole. */
export function extractApinexZeroPriceModelIds(payload: unknown): string[] {
  const models = asRecord(payload)?.models;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("APInex public catalog has no model records");
  }

  const seenIds = new Set<string>();
  const zeroPriceIds: string[] = [];
  for (const value of models) {
    const model = asRecord(value);
    if (!model) throw new Error("APInex public catalog has an invalid or duplicate model ID");
    const id = model.id;
    if (typeof id !== "string" || id.length === 0 || id.trim() !== id || seenIds.has(id)) {
      throw new Error("APInex public catalog has an invalid or duplicate model ID");
    }
    seenIds.add(id);

    const priceFields = Object.entries(model).filter(([key]) =>
      key.toLowerCase().endsWith("dollarsper1m")
    );
    const input = model.dollarsPer1M;
    const output = model.outputDollarsPer1M;
    if (
      typeof input !== "number" ||
      !Number.isFinite(input) ||
      input < 0 ||
      typeof output !== "number" ||
      !Number.isFinite(output) ||
      output < 0 ||
      priceFields.some(
        ([, price]) => typeof price !== "number" || !Number.isFinite(price) || price < 0
      )
    ) {
      throw new Error(`APInex public catalog has incomplete pricing for model "${id}"`);
    }

    if (priceFields.every(([, price]) => price === 0)) zeroPriceIds.push(id);
  }
  return zeroPriceIds;
}

function isApinexBaseUrl(baseUrl: string): boolean {
  return baseUrl === APINEX_BASE_URL || baseUrl === `${APINEX_BASE_URL}/`;
}

// AICODE-NOTE: Stored compatible type stays separate from API-format ID prefixes.
export function isApinexCatalogNode(node: Pick<ApinexCatalogNode, "type" | "baseUrl">): boolean {
  return node.type === "openai-compatible" && isApinexBaseUrl(node.baseUrl);
}

/** Bind source IDs to current exact APInex nodes and their already-synced raw IDs. */
export function bindApinexZeroPriceModels(
  zeroPriceModelIds: string[],
  nodes: ApinexCatalogNode[]
): Record<string, string[]> {
  const zeroPrice = new Set(zeroPriceModelIds);
  const modelsByProvider: Record<string, string[]> = {};
  for (const node of nodes) {
    if (!node.id || !isApinexCatalogNode(node)) continue;
    const models = Array.from(new Set(node.availableModelIds.filter((id) => zeroPrice.has(id))));
    if (models.length > 0) modelsByProvider[node.id] = models;
  }
  return modelsByProvider;
}

export function restrictApinexModelsToCurrentNodes(
  modelsByProvider: Record<string, string[]>,
  currentModelIds: Record<string, Set<string>>
): Record<string, string[]> {
  const current: Record<string, string[]> = {};
  for (const [provider, models] of Object.entries(modelsByProvider)) {
    const available = currentModelIds[provider];
    if (!available) continue;
    const matching = Array.from(new Set(models.filter((model) => available.has(model))));
    if (matching.length > 0) current[provider] = matching;
  }
  return current;
}

/** Validate only current APInex source metadata; freshness is checked per read. */
export function parseApinexZeroPriceEvidence(value: unknown): ApinexZeroPriceEvidence | null {
  const record = asRecord(value);
  if (
    !record ||
    record.sourceUrl !== APINEX_PUBLIC_MODELS_URL ||
    typeof record.fetchedAt !== "string" ||
    !hasValidModelMap(record.modelsByProvider)
  ) {
    return null;
  }
  return {
    sourceUrl: record.sourceUrl,
    fetchedAt: record.fetchedAt,
    modelsByProvider: record.modelsByProvider,
  };
}

function isFresh(fetchedAt: string, now: number): boolean {
  const timestamp = Date.parse(fetchedAt);
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now &&
    now - timestamp <= ZERO_PRICE_EVIDENCE_MAX_AGE_MS
  );
}

/** Recompose independently fresh evidence for the unchanged strict-zero reader. */
export function composeFreshZeroPriceEvidence(
  modelsDev: ZeroPriceSnapshot | null,
  apinex: ApinexZeroPriceEvidence | null,
  currentApinexModelIds: Record<string, Set<string>>,
  now: number
): ZeroPriceSnapshot | null {
  const sources: ZeroPriceSnapshot[] = [];
  if (
    modelsDev &&
    typeof modelsDev.fetchedAt === "string" &&
    hasValidModelMap(modelsDev.modelsByProvider) &&
    isFresh(modelsDev.fetchedAt, now) &&
    Object.values(modelsDev.modelsByProvider).some((models) => models.length > 0)
  ) {
    sources.push(modelsDev);
  }

  if (apinex?.sourceUrl === APINEX_PUBLIC_MODELS_URL && isFresh(apinex.fetchedAt, now)) {
    const currentModels = restrictApinexModelsToCurrentNodes(
      apinex.modelsByProvider,
      currentApinexModelIds
    );
    if (Object.values(currentModels).some((models) => models.length > 0)) {
      sources.push({ fetchedAt: apinex.fetchedAt, modelsByProvider: currentModels });
    }
  }

  if (sources.length === 0) return null;

  const modelsByProvider: Record<string, string[]> = {};
  for (const source of sources) {
    for (const [provider, models] of Object.entries(source.modelsByProvider)) {
      const merged = new Set([...(modelsByProvider[provider] ?? []), ...models]);
      modelsByProvider[provider] = Array.from(merged);
    }
  }
  const oldest = sources.reduce((current, source) =>
    Date.parse(source.fetchedAt) < Date.parse(current.fetchedAt) ? source : current
  );
  return { fetchedAt: oldest.fetchedAt, modelsByProvider };
}
