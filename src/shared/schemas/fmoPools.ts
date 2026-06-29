import { z } from "zod";

export const FMO_POOLS_CONTRACT_VERSION = "fmo-pools/v1";

const nonEmptyString = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const nonNegativeNumber = z.number().finite().nonnegative();

export const fmoPoolQualityBandSchema = z
  .object({
    category: nonEmptyString,
    min: nonNegativeNumber,
    max: nonNegativeNumber,
    relax: nonNegativeNumber,
  })
  .strict()
  .refine((band) => band.max >= band.min, {
    message: "quality_band.max must be greater than or equal to min",
    path: ["max"],
  });

export const fmoPoolDemandSchema = z
  .object({
    requests_per_day: positiveInteger,
    tokens_per_day: positiveInteger.optional(),
    concurrency: positiveInteger.optional(),
  })
  .strict();

export const fmoPoolTailEntrySchema = z
  .object({
    provider: nonEmptyString,
    model: nonEmptyString,
    account_id: nonEmptyString.optional(),
    reason: nonEmptyString.optional(),
  })
  .strict();

export const fmoPoolConstraintsSchema = z
  .object({
    min_context_tokens: positiveInteger,
    quality_band: fmoPoolQualityBandSchema,
    required_capabilities: z.array(nonEmptyString).default([]),
    hard_gates: z.array(nonEmptyString).default([]),
    max_latency_ms: positiveInteger.optional(),
  })
  .strict();

export const fmoPoolSpecSchema = z
  .object({
    pool_id: nonEmptyString,
    combo_id: nonEmptyString,
    demand: fmoPoolDemandSchema,
    constraints: fmoPoolConstraintsSchema,
    tail: z.array(fmoPoolTailEntrySchema).default([]),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const fmoPoolsGenerationSchema = z
  .object({
    contract: z.literal(FMO_POOLS_CONTRACT_VERSION),
    generation: nonEmptyString,
    generated_at: nonEmptyString,
    pools: z.array(fmoPoolSpecSchema).min(1),
  })
  .strict();

export type FmoPoolsGeneration = z.infer<typeof fmoPoolsGenerationSchema>;
export type FmoPoolSpec = z.infer<typeof fmoPoolSpecSchema>;
