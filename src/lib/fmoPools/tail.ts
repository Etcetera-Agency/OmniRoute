import type { FmoPlanningPool } from "./types";

export interface FmoTailEntry {
  providerId: string;
  modelId: string;
  capabilities: string[];
  contextWindow: number | null;
}

export interface FmoTailMember {
  role: "tail";
  providerId: string;
  modelId: string;
  connectionId: null;
  countedCapacity: 0;
}

export interface FmoTailConfig {
  entries: FmoTailEntry[];
}

export interface FmoTailLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

function hasCapabilities(entry: FmoTailEntry, pool: FmoPlanningPool): boolean {
  const required = pool.constraints.required_capabilities ?? [];
  return required.every((capability) => entry.capabilities.includes(capability));
}

function hasContext(entry: FmoTailEntry, pool: FmoPlanningPool): boolean {
  if (entry.contextWindow === null) return false;
  return entry.contextWindow >= pool.constraints.min_context_tokens;
}

export function buildFmoTail(
  pool: FmoPlanningPool,
  config: FmoTailConfig,
  headPinnedProviders: Set<string>,
  logger: FmoTailLogger = console
): FmoTailMember[] {
  const members: FmoTailMember[] = [];

  for (const entry of config.entries) {
    if (!hasCapabilities(entry, pool) || !hasContext(entry, pool)) continue;
    if (headPinnedProviders.has(entry.providerId)) {
      logger.warn("FMO tail provider is pinned in generation head; dropping tail entry", {
        providerId: entry.providerId,
        modelId: entry.modelId,
        poolId: pool.pool_id,
      });
      continue;
    }

    members.push({
      role: "tail",
      providerId: entry.providerId,
      modelId: entry.modelId,
      connectionId: null,
      countedCapacity: 0,
    });
  }

  return members;
}
