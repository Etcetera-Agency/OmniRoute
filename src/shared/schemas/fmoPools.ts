import { z } from "zod";

export const FMO_POOLS_CONTRACT_VERSION = "fmo-pools/v1";

const nonEmptyString = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const positiveFiniteNumber = z.number().finite().positive();
const nonNegativeNumber = z.number().finite().nonnegative();

export const fmoPoolQualityBandSchema = z
  .object({
    source: nonEmptyString,
    metric: nonEmptyString,
    category: nonEmptyString,
    min: nonNegativeNumber,
    max: nonNegativeNumber,
    relax: z
      .object({
        max_delta: nonNegativeNumber,
        when: nonEmptyString,
      })
      .strict(),
  })
  .strict()
  .refine((band) => band.max >= band.min, {
    message: "quality_band.max must be greater than or equal to min",
    path: ["max"],
  });

export const fmoPoolDemandSchema = z
  .object({
    requests_per_day: positiveFiniteNumber,
    consumers: positiveInteger.optional(),
    workload_class: nonEmptyString.optional(),
  })
  .strict();

export const fmoPoolTailIntentSchema = z
  .object({
    strategy: nonEmptyString,
    mode: nonEmptyString,
    compatibility: nonEmptyString,
  })
  .strict();

export const fmoPoolConstraintsSchema = z
  .object({
    free_only: z.boolean(),
    capabilities: z.array(nonEmptyString).default([]),
    min_context_tokens: positiveInteger,
    quality_band: fmoPoolQualityBandSchema,
  })
  .strict();

export const fmoPoolSpecSchema = z
  .object({
    pool_id: nonEmptyString,
    combo_id: nonEmptyString,
    demand: fmoPoolDemandSchema,
    constraints: fmoPoolConstraintsSchema,
    tail: fmoPoolTailIntentSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const fmoPoolRebalanceSchema = z
  .object({
    interval_minutes: positiveInteger,
  })
  .strict();

export const fmoPoolsGenerationSchema = z
  .object({
    contract_version: z.literal(FMO_POOLS_CONTRACT_VERSION),
    generation: nonEmptyString,
    generated_at: nonEmptyString.optional(),
    rebalance: fmoPoolRebalanceSchema,
    pools: z.array(fmoPoolSpecSchema).min(1),
  })
  .strict();

export type FmoPoolsGeneration = z.infer<typeof fmoPoolsGenerationSchema>;
export type FmoPoolSpec = z.infer<typeof fmoPoolSpecSchema>;
