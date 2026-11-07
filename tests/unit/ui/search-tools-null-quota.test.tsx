// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchProviderCatalogItem } from "../../../src/shared/schemas/searchTools";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/shared/components", () => ({
  Select: ({
    value,
    options,
    onChange,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  }) =>
    React.createElement(
      "select",
      { value, onChange },
      options.map((option) => React.createElement("option", { key: option.value, ...option }))
    ),
  Button: ({ children, disabled, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", { disabled, onClick }, children),
}));

const { default: SearchToolsConfigPane } =
  await import("../../../src/app/(dashboard)/dashboard/search-tools/components/SearchToolsConfigPane");
const { default: SearchForm } =
  await import("../../../src/app/(dashboard)/dashboard/search-tools/components/SearchForm");

const mdream: SearchProviderCatalogItem = {
  id: "mdream",
  name: "Mdream",
  kind: "fetch",
  costPerQuery: 0,
  freeMonthlyQuota: null,
  fetchFormats: ["markdown"],
  status: "configured",
  configureHref: "/dashboard/providers",
};

const containers: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = [];

function render(element: React.ReactElement): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(element));
  containers.push({ root, el });
  return el;
}

describe("search tool unknown monthly quota", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const { root, el } of containers.splice(0)) {
      act(() => root.unmount());
      el.remove();
    }
    document.body.innerHTML = "";
  });

  it("shows Mdream as free with no invented monthly quota in scrape config", () => {
    const el = render(
      React.createElement(SearchToolsConfigPane, {
        config: {
          provider: "mdream",
          searchType: "web",
          fetchFormat: "markdown",
          fullPage: false,
          rerankModel: "",
        },
        onConfigChange: () => {},
        providers: [mdream],
        activeTab: "scrape",
      })
    );
    expect(el.textContent).toContain("$0.0000");
    expect(el.textContent).not.toContain("/mo");
  });

  it("shows zero cost in the search form without a monthly quota", () => {
    const el = render(
      React.createElement(SearchForm, {
        onSearch: () => {},
        loading: false,
        onCancel: () => {},
        providers: [{ id: "mdream", name: "Mdream", status: "active", cost_per_query: 0 }],
        catalogProviders: [mdream],
      })
    );
    const select = el.querySelector("select") as HTMLSelectElement;
    act(() => {
      select.value = "mdream";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(el.textContent).toContain("$0.0000");
    expect(el.textContent).not.toContain("/mo");
  });
});
