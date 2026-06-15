// src/shared/schemas/searchTools.ts
import { z } from "zod";

/** Item exposto pelo /api/search/providers (estendido em F4). */
export const SearchProviderCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** "search" para os 12 search providers; "fetch" para firecrawl/jina/tavily-fetch. */
  kind: z.enum(["search", "fetch"]),
  costPerQuery: z.number().nonnegative(),
  freeMonthlyQuota: z.number().int().nonnegative(),
  searchTypes: z.array(z.string()).optional(), // só search
  fetchFormats: z.array(z.string()).optional(), // só fetch
  /** "configured" = creds presentes; "missing" = sem creds; "rate_limited" = todas as keys em cooldown. */
  status: z.enum(["configured", "missing", "rate_limited"]),
  /** 1-based automatic routing priority; null when provider is not in automatic routing. */
  order: z.number().int().positive().nullable().optional(),
  routingStatus: z.enum(["configured", "missing", "rate_limited"]).optional(),
  enabledForAuto: z.boolean().optional(),
  /** Link para configurar provider. */
  configureHref: z.string().default("/dashboard/providers"),
});
export type SearchProviderCatalogItem = z.infer<typeof SearchProviderCatalogItemSchema>;

export const RoutingEndpointSchema = z.enum(["search", "fetch"]);

export const RoutingOverrideRequestSchema = z.object({
  endpoint: RoutingEndpointSchema,
  order: z.array(z.string()).default([]),
  disabled: z.array(z.string()).default([]),
  reset: z.boolean().optional(),
});
export type RoutingOverrideRequest = z.infer<typeof RoutingOverrideRequestSchema>;

export const RoutingConfigSchema = z.object({
  endpoint: RoutingEndpointSchema,
  order: z.array(z.string()),
  disabled: z.array(z.string()),
  override: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;

export const SearchProviderCatalogResponseSchema = z.object({
  providers: z.array(SearchProviderCatalogItemSchema),
  routing: z
    .object({
      search: RoutingConfigSchema,
      fetch: RoutingConfigSchema,
    })
    .optional(),
});

/** ScrapeResult mostrado na aba Scrape (já é a resposta de /v1/web/fetch, mas tipado). */
export const ScrapeResultSchema = z.object({
  provider: z.string(),
  url: z.string(),
  content: z.string(),
  links: z.array(z.string()),
  metadata: z
    .object({
      title: z.string().nullable(),
      description: z.string().nullable(),
    })
    .nullable(),
  screenshot_url: z.string().nullable(),
});
export type ScrapeResult = z.infer<typeof ScrapeResultSchema>;

export const SearchProviderCatalogResponseSchemaFull = SearchProviderCatalogResponseSchema;
