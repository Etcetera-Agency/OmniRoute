"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { Select } from "@/shared/components";
import type { SearchProviderCatalogItem } from "@/shared/schemas/searchTools";
import type { ActiveTab } from "./SearchToolsTopBar";

export interface ConfigState {
  provider: string;
  searchType: "web" | "news";
  fetchFormat: "markdown" | "html" | "text";
  fullPage: boolean;
  rerankModel: string;
}

interface SearchToolsConfigPaneProps {
  config: ConfigState;
  onConfigChange: (patch: Partial<ConfigState>) => void;
  providers: SearchProviderCatalogItem[];
  activeTab: ActiveTab;
  rerankModels?: { value: string; label: string }[];
  onProvidersRefresh?: () => void;
}

export default function SearchToolsConfigPane({
  config,
  onConfigChange,
  providers,
  activeTab,
  rerankModels = [],
  onProvidersRefresh,
}: SearchToolsConfigPaneProps) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [routingSaving, setRoutingSaving] = useState(false);

  const searchProviders = providers.filter((p) => p.kind === "search" && p.status !== "missing");
  const fetchProviders = providers.filter((p) => p.kind === "fetch" && p.status !== "missing");
  const relevantProviders = activeTab === "scrape" ? fetchProviders : searchProviders;
  const routingEndpoint = activeTab === "scrape" ? "fetch" : "search";
  const routingProviders = useMemo(
    () =>
      providers
        .filter((p) => p.kind === routingEndpoint && p.order != null)
        .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)),
    [providers, routingEndpoint]
  );
  const disabledProviderIds = useMemo(
    () =>
      routingProviders
        .filter((p) => p.status === "missing" || p.enabledForAuto === false)
        .map((p) => p.id),
    [routingProviders]
  );

  const selectedProvider = providers.find((p) => p.id === config.provider);
  const canEditRouting = activeTab === "search" || activeTab === "scrape";

  async function saveRouting(order: string[], disabled: string[]) {
    setRoutingSaving(true);
    try {
      const response = await globalThis.fetch("/api/search/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: routingEndpoint, order, disabled }),
      });
      if (!response.ok) return;
      onProvidersRefresh?.();
    } finally {
      setRoutingSaving(false);
    }
  }

  async function resetRouting() {
    setRoutingSaving(true);
    try {
      const response = await globalThis.fetch("/api/search/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: routingEndpoint, order: [], disabled: [], reset: true }),
      });
      if (!response.ok) return;
      onProvidersRefresh?.();
    } finally {
      setRoutingSaving(false);
    }
  }

  function moveProvider(providerId: string, direction: -1 | 1) {
    const order = routingProviders.map((p) => p.id);
    const index = order.indexOf(providerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    void saveRouting(order, disabledProviderIds);
  }

  function toggleProvider(provider: SearchProviderCatalogItem, enabled: boolean) {
    if (provider.status === "missing") return;
    const disabled = new Set(disabledProviderIds);
    if (enabled) disabled.delete(provider.id);
    else disabled.add(provider.id);
    void saveRouting(
      routingProviders.map((p) => p.id),
      [...disabled]
    );
  }

  return (
    <aside
      className="w-[220px] shrink-0 border-l border-border bg-bg-alt overflow-y-auto flex flex-col"
      data-testid="search-tools-config-pane"
      aria-label="Configuration pane"
    >
      <div className="p-3 border-b border-border">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Configuration
        </span>
      </div>

      {/* Provider selector */}
      <div className="p-3 border-b border-border space-y-2">
        <label className="block text-[10px] text-text-muted uppercase tracking-wider mb-1">
          Provider
        </label>
        <Select
          value={config.provider}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            onConfigChange({ provider: e.target.value })
          }
          options={[
            { value: "auto", label: "Auto (cheapest)" },
            ...relevantProviders.map((p) => ({ value: p.id, label: p.name })),
          ]}
          className="w-full"
        />

        {/* Provider metadata inline */}
        {selectedProvider && (
          <div className="text-[10px] text-text-muted space-y-0.5">
            <div>
              Cost:{" "}
              <span className="text-text-main font-medium">
                ${selectedProvider.costPerQuery.toFixed(4)}/query
              </span>
            </div>
            {selectedProvider.freeMonthlyQuota > 0 && (
              <div>
                Free quota:{" "}
                <span className="text-text-main font-medium">
                  {selectedProvider.freeMonthlyQuota >= 1000
                    ? `${(selectedProvider.freeMonthlyQuota / 1000).toFixed(0)}k`
                    : selectedProvider.freeMonthlyQuota}
                  /mo
                </span>
              </div>
            )}
            <div className="flex items-center gap-1">
              Status:{" "}
              <span
                className={
                  selectedProvider.status === "configured"
                    ? "text-success font-medium"
                    : selectedProvider.status === "rate_limited"
                      ? "text-warning font-medium"
                      : "text-text-muted font-medium"
                }
              >
                {selectedProvider.status === "configured"
                  ? "Configured"
                  : selectedProvider.status === "rate_limited"
                    ? "Rate limited"
                    : "Missing credential"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Search tab options */}
      {activeTab === "search" && (
        <div className="p-3 border-b border-border space-y-2">
          <label className="block text-[10px] text-text-muted uppercase tracking-wider mb-1">
            Search type
          </label>
          <Select
            value={config.searchType}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              onConfigChange({ searchType: e.target.value as "web" | "news" })
            }
            options={[
              { value: "web", label: "Web" },
              { value: "news", label: "News" },
            ]}
            className="w-full"
          />
        </div>
      )}

      {/* Scrape tab options */}
      {activeTab === "scrape" && (
        <div className="p-3 border-b border-border space-y-2">
          <label className="block text-[10px] text-text-muted uppercase tracking-wider mb-1">
            Format
          </label>
          <Select
            value={config.fetchFormat}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              onConfigChange({ fetchFormat: e.target.value as ConfigState["fetchFormat"] })
            }
            options={[
              { value: "markdown", label: "Markdown" },
              { value: "html", label: "HTML" },
              { value: "text", label: "Text" },
            ]}
            className="w-full"
          />
          <label className="flex items-center gap-2 cursor-pointer mt-2">
            <input
              type="checkbox"
              checked={config.fullPage}
              onChange={(e) => onConfigChange({ fullPage: e.target.checked })}
              className="rounded"
            />
            <span className="text-xs text-text-main">Full page</span>
          </label>
        </div>
      )}

      {/* Compare tab options */}
      {activeTab === "compare" && (
        <div className="p-3 border-b border-border">
          <div className="text-[10px] text-text-muted">
            Select up to 4 providers on the Compare tab to compare them side by side.
          </div>
        </div>
      )}

      {/* Rerank model (only for search tab) */}
      {activeTab === "search" && rerankModels.length > 0 && (
        <div className="p-3 border-b border-border space-y-1">
          <label className="block text-[10px] text-text-muted uppercase tracking-wider mb-1">
            Rerank model
          </label>
          <Select
            value={config.rerankModel}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              onConfigChange({ rerankModel: e.target.value })
            }
            options={[{ value: "", label: "None" }, ...rerankModels]}
            className="w-full"
          />
        </div>
      )}

      {canEditRouting && (
        <div className="p-3 border-b border-border space-y-2" data-testid="routing-config">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-muted uppercase tracking-wider">
              Routing
            </span>
            <button
              type="button"
              onClick={() => void resetRouting()}
              disabled={routingSaving}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-text-muted hover:text-text-main disabled:opacity-50"
              aria-label="Reset routing order"
              title="Reset routing order"
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-1">
            {routingProviders.map((provider, index) => {
              const enabled = provider.status !== "missing" && provider.enabledForAuto !== false;
              return (
                <div
                  key={`${provider.kind}:${provider.id}`}
                  className="flex items-center gap-1 rounded border border-border/50 bg-bg-subtle px-2 py-1"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={routingSaving || provider.status === "missing"}
                      onChange={(e) => toggleProvider(provider, e.target.checked)}
                      aria-label={`${provider.name} automatic routing`}
                    />
                    <span className="min-w-0 truncate text-xs text-text-main">
                      {provider.name}
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={routingSaving || index === 0}
                    onClick={() => moveProvider(provider.id, -1)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-text-muted hover:text-text-main disabled:opacity-40"
                    aria-label={`Move ${provider.name} up`}
                    title="Move up"
                  >
                    <ChevronUp size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={routingSaving || index === routingProviders.length - 1}
                    onClick={() => moveProvider(provider.id, 1)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-text-muted hover:text-text-main disabled:opacity-40"
                    aria-label={`Move ${provider.name} down`}
                    title="Move down"
                  >
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* History section (collapsible placeholder) */}
      <div className="p-3 flex-1">
        <button
          className="flex justify-between items-center w-full"
          onClick={() => setHistoryExpanded((e) => !e)}
          aria-expanded={historyExpanded}
        >
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            History
          </span>
          <span className="text-text-muted text-xs" aria-hidden="true">
            {historyExpanded ? "▼" : "▶"}
          </span>
        </button>
        {historyExpanded && (
          <div className="mt-2 text-[10px] text-text-muted">
            History is available on the Search tab.
          </div>
        )}
      </div>
    </aside>
  );
}
