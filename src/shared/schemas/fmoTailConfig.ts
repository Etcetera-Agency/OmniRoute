import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const fmoTailConfigEntrySchema = z
  .object({
    providerId: nonEmptyString,
    modelId: nonEmptyString,
    capabilities: z.array(nonEmptyString),
    contextWindow: z.number().int().positive().nullable(),
  })
  .strict();

export const fmoTailConfigSchema = z
  .object({
    providers: z.array(nonEmptyString),
    entries: z.array(fmoTailConfigEntrySchema),
  })
  .strict();

export type FmoTailConfigSource = z.infer<typeof fmoTailConfigSchema>;
