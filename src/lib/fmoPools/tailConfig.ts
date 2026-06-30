import fs from "node:fs";
import { FMO_TAIL_CONFIG } from "@omniroute/open-sse/config/fmoTailConfig.ts";
import { fmoTailConfigSchema } from "@/shared/schemas/fmoTailConfig";
import type { FmoTailConfig } from "./tail";
import type { FmoPoolTailConfig } from "./types";

export interface FmoTailConfigLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

const EMPTY_TAIL_CONFIG: FmoTailConfig = { entries: [] };
const EMPTY_TAIL_PROVIDER_CONFIG: FmoPoolTailConfig = { providers: [] };
const TAIL_CONFIG_PATH_ENV = "OMNIROUTE_FMO_TAIL_CONFIG_PATH";

function loadTailConfigSource(): unknown {
  const configPath = process.env[TAIL_CONFIG_PATH_ENV]?.trim();
  if (!configPath) return FMO_TAIL_CONFIG;

  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function readValidatedTailConfig(logger: FmoTailConfigLogger = console): {
  entries: FmoTailConfig["entries"];
  providers: string[];
} {
  try {
    const parsed = fmoTailConfigSchema.safeParse(loadTailConfigSource());
    if (parsed.success) return parsed.data;

    logger.warn("FMO tail config is malformed; using empty tail config", {
      configPath: process.env[TAIL_CONFIG_PATH_ENV],
      errors: parsed.error.issues,
    });
  } catch (error) {
    logger.warn("FMO tail config could not be read; using empty tail config", {
      configPath: process.env[TAIL_CONFIG_PATH_ENV],
      error,
    });
  }

  return { ...EMPTY_TAIL_CONFIG, ...EMPTY_TAIL_PROVIDER_CONFIG };
}

export function readFmoTailConfig(logger: FmoTailConfigLogger = console): FmoTailConfig {
  // AICODE-NOTE: This reads on every generation build so env/file changes affect the next rebuild.
  return { entries: readValidatedTailConfig(logger).entries };
}

export function readFmoTailProviderConfig(
  logger: FmoTailConfigLogger = console
): FmoPoolTailConfig {
  return { providers: readValidatedTailConfig(logger).providers };
}
