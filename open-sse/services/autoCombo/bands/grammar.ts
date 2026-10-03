export const BAND_TASKS = ["general", "coding"] as const;
export const QUALITY_BANDS = ["low", "mid", "high"] as const;
export const BAND_CAPABILITIES = ["tools", "so", "reasoning", "vision"] as const;

export type BandTask = (typeof BAND_TASKS)[number];
export type QualityBand = (typeof QUALITY_BANDS)[number];
export type BandCapability = (typeof BAND_CAPABILITIES)[number];

export interface ParsedBandId {
  task: BandTask;
  band: QualityBand;
  capabilities: BandCapability[];
}

const TASK_SET = new Set<string>(BAND_TASKS);
const BAND_SET = new Set<string>(QUALITY_BANDS);
const CAPABILITY_SET = new Set<string>(BAND_CAPABILITIES);

// AICODE-NOTE: bands seam — parse only the opaque task/band/capability category;
// upstream tier syntax remains owned by suffixComposition.ts.
export function parseBandId(value: string | null | undefined): ParsedBandId | null {
  if (typeof value !== "string" || value.length === 0) return null;

  const [task, band, ...capabilities] = value.split("_");
  if (!TASK_SET.has(task) || !BAND_SET.has(band)) return null;
  if (capabilities.some((capability) => !CAPABILITY_SET.has(capability))) return null;
  if (new Set(capabilities).size !== capabilities.length) return null;

  return {
    task: task as BandTask,
    band: band as QualityBand,
    capabilities: BAND_CAPABILITIES.filter((capability) => capabilities.includes(capability)),
  };
}
