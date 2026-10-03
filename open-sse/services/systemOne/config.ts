export type SystemOneUpstreamName = "laya" | "typesafe" | "openrouter";

export interface SystemOneUpstreamConfig {
  name: SystemOneUpstreamName;
  url: string;
  apiKey?: string;
  model?: string;
  connectionId: string;
}

export interface SystemOneConfig {
  enabled: boolean;
  order: SystemOneUpstreamName[];
  upstreams: Record<SystemOneUpstreamName, SystemOneUpstreamConfig | null>;
  timeoutMs: number;
  cooldownMs: number;
}

export const SYSTEMONE_REQUIRED_VARIABLES: Record<SystemOneUpstreamName, string> = {
  laya: "OMNIROUTE_SYSTEMONE_LAYA_URL",
  typesafe: "OMNIROUTE_SYSTEMONE_TYPESAFE_API_KEY",
  openrouter: "OMNIROUTE_SYSTEMONE_OPENROUTER_API_KEY",
};

const DEFAULT_ORDER: SystemOneUpstreamName[] = ["laya", "typesafe", "openrouter"];
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_COOLDOWN_MS = 30_000;

function readOptionalEnvironmentValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readMilliseconds(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isSystemOneUpstreamName(value: string): value is SystemOneUpstreamName {
  return value === "laya" || value === "typesafe" || value === "openrouter";
}

function readConfiguredOrder(value: string | undefined): SystemOneUpstreamName[] {
  const source = value === undefined ? DEFAULT_ORDER : value.split(",");
  const seen = new Set<SystemOneUpstreamName>();
  const order: SystemOneUpstreamName[] = [];

  for (const entry of source) {
    const normalized = entry.trim().toLowerCase();
    if (!isSystemOneUpstreamName(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    order.push(normalized);
  }

  return order;
}

function systemOneIsEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function loadSystemOneConfig(env: NodeJS.ProcessEnv = process.env): SystemOneConfig {
  const layaUrl = readOptionalEnvironmentValue(env.OMNIROUTE_SYSTEMONE_LAYA_URL);
  const layaApiKey = readOptionalEnvironmentValue(env.OMNIROUTE_SYSTEMONE_LAYA_API_KEY);
  const typesafeApiKey = readOptionalEnvironmentValue(env.OMNIROUTE_SYSTEMONE_TYPESAFE_API_KEY);
  const openrouterApiKey = readOptionalEnvironmentValue(env.OMNIROUTE_SYSTEMONE_OPENROUTER_API_KEY);
  const upstreams: SystemOneConfig["upstreams"] = {
    laya: layaUrl
      ? {
          name: "laya",
          url: `${layaUrl.replace(/\/+$/, "")}/v1/systemone`,
          apiKey: layaApiKey,
          model: readOptionalEnvironmentValue(env.OMNIROUTE_SYSTEMONE_LAYA_MODEL),
          connectionId: "env:OMNIROUTE_SYSTEMONE_LAYA",
        }
      : null,
    typesafe: typesafeApiKey
      ? {
          name: "typesafe",
          url: "https://api.typesafe.ai/v1/systemone",
          apiKey: typesafeApiKey,
          model:
            readOptionalEnvironmentValue(env.OMNIROUTE_SYSTEMONE_TYPESAFE_MODEL) ?? "jev-latest",
          connectionId: "env:OMNIROUTE_SYSTEMONE_TYPESAFE",
        }
      : null,
    openrouter: openrouterApiKey
      ? {
          name: "openrouter",
          url: "https://openrouter.ai/api/alpha/decisions",
          apiKey: openrouterApiKey,
          model:
            readOptionalEnvironmentValue(env.OMNIROUTE_SYSTEMONE_OPENROUTER_MODEL) ??
            "typesafe/jev-1.13",
          connectionId: "env:OMNIROUTE_SYSTEMONE_OPENROUTER",
        }
      : null,
  };

  const order = readConfiguredOrder(env.OMNIROUTE_SYSTEMONE_ORDER).filter(
    (name) => upstreams[name] !== null
  );

  return {
    enabled: systemOneIsEnabled(env.OMNIROUTE_SYSTEMONE),
    order,
    upstreams,
    timeoutMs: readMilliseconds(env.OMNIROUTE_SYSTEMONE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    cooldownMs: readMilliseconds(env.OMNIROUTE_SYSTEMONE_COOLDOWN_MS, DEFAULT_COOLDOWN_MS),
  };
}
