import { createHash } from "node:crypto";

import { CORS_HEADERS } from "@/shared/utils/cors";
import { generateProviderPluginManifest } from "@omniroute/open-sse/config/providerPluginManifestRegistry.ts";
import { getServiceRow } from "@/lib/db/versionManager";
import { getServiceModels, type ServiceModel } from "@/lib/db/serviceModels";
import {
  SERVICE_BACKEND_MANIFEST_TEMPLATE,
  SERVICE_BACKEND_PLUGIN_IDS,
  getServiceToolFromPluginId,
  isServiceBackendPluginId,
} from "@/lib/services/serviceBackends";
import type {
  ProviderPluginManifest,
  ProviderPluginManifestEntry,
  ProviderPluginModel,
} from "@omniroute/open-sse/config/providerPluginManifest.ts";

const SERVICE_BACKEND_PLUGIN_ID_SET = new Set<string>(SERVICE_BACKEND_PLUGIN_IDS);

function createServiceManifestTemplate(providerId: string): ProviderPluginManifestEntry | null {
  const entry =
    SERVICE_BACKEND_MANIFEST_TEMPLATE[providerId as keyof typeof SERVICE_BACKEND_MANIFEST_TEMPLATE];
  if (!entry) return null;

  return {
    id: providerId,
    format: entry.format,
    executor: entry.executor,
    auth: entry.auth,
    endpoints: entry.endpoints,
    capabilities: [...entry.capabilities],
    passthroughModels: entry.passthroughModels,
    models: [],
    sidecar: entry.sidecar,
  };
}

const SERVICE_MODEL_CACHE_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "public, max-age=60",
} as const;

function normalizeServiceModelId(pluginId: string, rawModelId: string): string {
  if (!rawModelId) return "";

  const serviceTool = getServiceToolFromPluginId(pluginId);
  // AICODE-NOTE: persisted ids can carry the supervisor prefix; manifests must
  // expose the client-facing plugin prefix instead.
  if (serviceTool && rawModelId.startsWith(`${serviceTool}/`)) {
    return `${pluginId}/${rawModelId.slice(serviceTool.length + 1)}`;
  }

  return rawModelId.includes("/") ? rawModelId : `${pluginId}/${rawModelId}`;
}

function isValidServiceModelEntry(entry: ServiceModel): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  if (typeof entry.id !== "string" || !entry.id.trim()) return false;
  if (entry.available === false) return false;
  return true;
}

function toProviderPluginModel(pluginId: string, model: ServiceModel): ProviderPluginModel {
  const id = normalizeServiceModelId(pluginId, model.id);
  return {
    id,
    name: typeof model.name === "string" ? model.name : id,
    contextLength:
      typeof model.contextLength === "number" && Number.isFinite(model.contextLength)
        ? model.contextLength
        : undefined,
    maxOutputTokens:
      typeof model.maxOutputTokens === "number" && Number.isFinite(model.maxOutputTokens)
        ? model.maxOutputTokens
        : undefined,
    supportsReasoning: Boolean(model.supportsReasoning),
    supportsVision: Boolean(model.supportsVision),
    unsupportedParams:
      Array.isArray(model.unsupportedParams) && model.unsupportedParams.length > 0
        ? model.unsupportedParams
        : undefined,
    targetFormat: typeof model.targetFormat === "string" ? model.targetFormat : undefined,
  };
}

function pickServiceModels(
  pluginId: string,
  reader: (toolName: string) => ServiceModel[]
): ProviderPluginModel[] {
  const models = reader(pluginId).filter(isValidServiceModelEntry);

  const unique = new Map<string, ProviderPluginModel>();
  for (const model of models) {
    const pluginModel = toProviderPluginModel(pluginId, model);
    if (!unique.has(pluginModel.id)) {
      unique.set(pluginModel.id, pluginModel);
    }
  }

  return [...unique.values()];
}

async function shouldExposeServiceModels(toolName: string): Promise<boolean> {
  if (!SERVICE_BACKEND_PLUGIN_ID_SET.has(toolName)) return true;

  const serviceTool = getServiceToolFromPluginId(toolName) ?? toolName;
  const row = await getServiceRow(serviceTool);
  if (!row) return true;
  return row.providerExpose;
}

function shouldInjectBackendPluginModels(provider: ProviderPluginManifestEntry): boolean {
  return isServiceBackendPluginId(provider.id);
}

export function readServiceModelsForManifest(
  pluginId: string,
  reader: (toolName: string) => ServiceModel[] = getServiceModels
): ServiceModel[] {
  // AICODE-NOTE: manifest ids are client-facing (cliproxyapi), while persisted
  // service rows use canonical supervisor tools (cliproxy).
  const serviceTool = getServiceToolFromPluginId(pluginId) ?? pluginId;
  return reader(serviceTool);
}

export async function injectServiceModelsIntoManifest(
  manifest: ProviderPluginManifest,
  reader: (toolName: string) => ServiceModel[] = getServiceModels,
  exposeReader?: (toolName: string) => Promise<boolean> | boolean
): Promise<ProviderPluginManifest> {
  // AICODE-NOTE: keep model injection pure for callers that supply a reader; the
  // live route passes shouldExposeServiceModels explicitly to enforce exposure policy.
  const providers: ProviderPluginManifestEntry[] = [...manifest.providers];
  for (const providerId of SERVICE_BACKEND_PLUGIN_ID_SET) {
    const exists = providers.some((provider) => provider.id === providerId);
    if (exists) continue;

    const template = createServiceManifestTemplate(providerId);
    if (template) providers.push(template);
  }

  const providersWithServiceModels = await Promise.all(
    providers.map(async (provider) => {
      if (!shouldInjectBackendPluginModels(provider)) return provider;

      try {
        if (exposeReader && !Boolean(await exposeReader(provider.id))) return provider;

        const models = pickServiceModels(provider.id, reader);
        if (models.length === 0) return provider;

        const mergedModels = [...provider.models];
        const modelIds = new Set(provider.models.map((model) => model.id));
        for (const model of models) {
          if (!modelIds.has(model.id)) {
            mergedModels.push(model);
            modelIds.add(model.id);
          }
        }

        return { ...provider, models: mergedModels };
      } catch {
        return provider;
      }
    })
  );

  return {
    ...manifest,
    providers: providersWithServiceModels,
  };
}

function createEtag(body: string): string {
  return `"${createHash("sha256").update(body).digest("base64url")}"`;
}

function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  return Boolean(
    ifNoneMatch
      ?.split(",")
      .map((value) => value.trim())
      .some((value) => value === "*" || value === etag || value === `W/${etag}`)
  );
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

// #7744-adjacent: the manifest embeds live service-backend model state (which can
// change while the process runs — see shouldExposeServiceModels/getServiceModels),
// so the body itself is NOT cached across requests (unlike the module-static
// provider registry snapshot). ETag/If-None-Match support is still computed per
// request so unchanged responses can short-circuit to a 304.
export async function GET(request: Request) {
  const body = JSON.stringify(
    await injectServiceModelsIntoManifest(
      generateProviderPluginManifest(),
      readServiceModelsForManifest,
      shouldExposeServiceModels
    )
  );
  const etag = createEtag(body);
  const headers = { ...SERVICE_MODEL_CACHE_HEADERS, ETag: etag };

  if (matchesEtag(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
