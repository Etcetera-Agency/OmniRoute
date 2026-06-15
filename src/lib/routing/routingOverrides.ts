import { getSettings, updateSettings } from "@/lib/db/settings";

export type RoutingEndpoint = "search" | "fetch";

export interface RoutingOverride {
  endpoint: RoutingEndpoint;
  order: string[];
  disabled: string[];
  updatedAt: string;
}

export interface RoutingOverrideInput {
  endpoint: RoutingEndpoint;
  order: string[];
  disabled?: string[];
}

type RoutingOverrideStore = Partial<Record<RoutingEndpoint, RoutingOverride>>;

const SETTINGS_KEY = "routingOverrides";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

function normalizeStoredOverride(endpoint: RoutingEndpoint, value: unknown): RoutingOverride | null {
  const record = toRecord(value);
  const order = uniqueStrings(record.order);
  const disabled = uniqueStrings(record.disabled);
  const updatedAt =
    typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString();
  if (order.length === 0 && disabled.length === 0) return null;
  return { endpoint, order, disabled, updatedAt };
}

async function loadStore(): Promise<RoutingOverrideStore> {
  const settings = await getSettings();
  const rawStore = toRecord(settings[SETTINGS_KEY]);
  const store: RoutingOverrideStore = {};
  for (const endpoint of ["search", "fetch"] as const) {
    const override = normalizeStoredOverride(endpoint, rawStore[endpoint]);
    if (override) store[endpoint] = override;
  }
  return store;
}

export async function loadRoutingOverride(
  endpoint: RoutingEndpoint
): Promise<RoutingOverride | null> {
  return (await loadStore())[endpoint] ?? null;
}

export async function saveRoutingOverride(input: RoutingOverrideInput): Promise<RoutingOverride> {
  const override: RoutingOverride = {
    endpoint: input.endpoint,
    order: uniqueStrings(input.order),
    disabled: uniqueStrings(input.disabled),
    updatedAt: new Date().toISOString(),
  };
  const store = await loadStore();
  store[input.endpoint] = override;
  await updateSettings({ [SETTINGS_KEY]: store });
  return override;
}

export async function resetRoutingOverride(endpoint: RoutingEndpoint): Promise<void> {
  const store = await loadStore();
  delete store[endpoint];
  await updateSettings({ [SETTINGS_KEY]: store });
}

export async function resolveEffectiveProviderOrder(
  endpoint: RoutingEndpoint,
  defaultOrder: readonly string[],
  isEligible: (providerId: string) => boolean = () => true
): Promise<string[]> {
  const override = await loadRoutingOverride(endpoint);
  const eligibleDefaults = defaultOrder.filter(isEligible);
  if (!override) return [...eligibleDefaults];

  const defaultIds = new Set(defaultOrder);
  const disabled = new Set(override.disabled);
  const ordered = override.order.filter(
    (id) => defaultIds.has(id) && isEligible(id) && !disabled.has(id)
  );

  for (const id of eligibleDefaults) {
    if (!ordered.includes(id) && !disabled.has(id)) ordered.push(id);
  }

  return ordered;
}

export async function buildEffectiveRoutingConfig(
  endpoint: RoutingEndpoint,
  defaultOrder: readonly string[]
): Promise<{
  endpoint: RoutingEndpoint;
  order: string[];
  disabled: string[];
  override: boolean;
  updatedAt: string | null;
}> {
  const override = await loadRoutingOverride(endpoint);
  return {
    endpoint,
    order: await resolveEffectiveProviderOrder(endpoint, defaultOrder),
    disabled: override?.disabled ?? [],
    override: Boolean(override),
    updatedAt: override?.updatedAt ?? null,
  };
}
