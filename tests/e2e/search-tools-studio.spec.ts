import { test, expect } from "@playwright/test";
import { gotoDashboardRoute } from "./helpers/dashboardAuth";

test.describe("Search Tools Studio", () => {
  test.beforeEach(async ({ page }) => {
    let providers = [
      {
        id: "brave-search",
        name: "Brave Search",
        kind: "search",
        costPerQuery: 0.005,
        freeMonthlyQuota: 1000,
        searchTypes: ["web", "news"],
        status: "configured",
        order: 1,
        enabledForAuto: true,
        configureHref: "/dashboard/providers",
      },
      {
        id: "tavily-search",
        name: "Tavily Search",
        kind: "search",
        costPerQuery: 0.008,
        freeMonthlyQuota: 1000,
        searchTypes: ["web", "news"],
        status: "configured",
        order: 2,
        enabledForAuto: true,
        configureHref: "/dashboard/providers",
      },
      {
        id: "exa-search",
        name: "Exa Search",
        kind: "search",
        costPerQuery: 0.007,
        freeMonthlyQuota: 1000,
        searchTypes: ["web"],
        status: "missing",
        order: null,
        enabledForAuto: false,
        configureHref: "/dashboard/providers",
      },
      {
        id: "mdream",
        name: "Mdream",
        kind: "fetch",
        costPerQuery: 0,
        freeMonthlyQuota: 999999,
        fetchFormats: ["markdown"],
        status: "configured",
        order: 1,
        enabledForAuto: true,
        configureHref: "/dashboard/providers",
      },
      {
        id: "firecrawl",
        name: "Firecrawl",
        kind: "fetch",
        costPerQuery: 0.002,
        freeMonthlyQuota: 0,
        fetchFormats: ["markdown", "html", "links"],
        status: "configured",
        order: 2,
        enabledForAuto: true,
        configureHref: "/dashboard/providers",
      },
    ];

    // Mock the search providers catalog API
    await page.route("**/api/search/providers", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as {
          endpoint: "search" | "fetch";
          order: string[];
          disabled: string[];
          reset?: boolean;
        };
        const kind = body.endpoint === "fetch" ? "fetch" : "search";
        if (body.reset) {
          let order = 0;
          providers = providers.map((provider) =>
            provider.kind === kind
              ? { ...provider, order: ++order, enabledForAuto: provider.status !== "missing" }
              : provider
          );
        } else {
          providers = providers.map((provider) => {
            if (provider.kind !== kind) return provider;
            return {
              ...provider,
              order: body.order.indexOf(provider.id) + 1 || null,
              enabledForAuto:
                provider.status !== "missing" && !body.disabled.includes(provider.id),
            };
          });
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ routing: { endpoint: body.endpoint, order: body.order } }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ providers }),
      });
    });

    // Mock the search endpoint
    await page.route("**/api/v1/search", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          provider: "serper",
          results: [
            {
              title: "Test Result",
              url: "https://example.com",
              snippet: "A test search result",
              score: 0.9,
            },
          ],
          cost: 0.001,
        }),
      });
    });

    // Mock the web fetch endpoint
    await page.route("**/api/v1/web/fetch", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          provider: "firecrawl",
          url: "https://example.com",
          content: "# Example Page\n\nThis is a test page.",
          links: ["https://example.com/about"],
          metadata: { title: "Example", description: "Test" },
          screenshot_url: null,
        }),
      });
    });
  });

  test("loads page and shows 3 tabs", async ({ page }) => {
    await gotoDashboardRoute(page, "/dashboard/search-tools");

    await expect(page.locator("body")).toBeVisible();

    // The Studio should render 3 tabs in a tablist
    const tablist = page.getByRole("tablist").first();
    await expect(tablist).toBeVisible({ timeout: 15000 });

    // Check all 3 tabs are present
    const searchTab = page.getByRole("tab", { name: /search/i }).first();
    const scrapeTab = page.getByRole("tab", { name: /scrape/i });
    const compareTab = page.getByRole("tab", { name: /compare/i });

    await expect(searchTab).toBeVisible({ timeout: 15000 });
    await expect(scrapeTab).toBeVisible({ timeout: 15000 });
    await expect(compareTab).toBeVisible({ timeout: 15000 });
  });

  test("shows SearchConceptCard (modalities guide)", async ({ page }) => {
    await gotoDashboardRoute(page, "/dashboard/search-tools");

    // The concept card should be visible and contain a modalities guide
    // It may be rendered as a collapsible section
    const conceptCard = page.locator("[data-testid='search-concept-card'], .search-concept-card").first();

    // Alternative: look for the guide text since it's always visible
    // The card has a "Modalities guide" or similar label
    const guideText = page
      .getByText(/modalities guide|guia de modalidades/i)
      .first();
    await expect(guideText).toBeVisible({ timeout: 15000 });
  });

  test("switches to Scrape tab and shows URL input", async ({ page }) => {
    await gotoDashboardRoute(page, "/dashboard/search-tools");

    // Wait for tabs
    const scrapeTab = page.getByRole("tab", { name: /scrape/i });
    await expect(scrapeTab).toBeVisible({ timeout: 15000 });

    // Click Scrape tab
    await scrapeTab.click();

    // The Scrape tab should have a URL input
    const urlInput = page.locator('input[type="url"], input[placeholder*="http"], input[placeholder*="URL"], input[placeholder*="url"]').first();
    await expect(urlInput).toBeVisible({ timeout: 10000 });
  });

  test("Search tab is active by default", async ({ page }) => {
    await gotoDashboardRoute(page, "/dashboard/search-tools");

    const searchTab = page.getByRole("tab", { name: /search/i }).first();
    await expect(searchTab).toBeVisible({ timeout: 15000 });

    // Search tab should be selected by default
    await expect(searchTab).toHaveAttribute("aria-selected", "true");
  });

  test("edits routing order, toggles provider, and resets", async ({ page }) => {
    await gotoDashboardRoute(page, "/dashboard/search-tools");

    await expect(page.getByTestId("routing-config")).toBeVisible({ timeout: 15000 });
    await page.getByLabel("Move Tavily Search up").click();
    await expect(page.getByLabel("Move Tavily Search up")).toBeDisabled();

    const braveToggle = page.getByLabel("Brave Search automatic routing");
    await braveToggle.click();
    await expect(braveToggle).not.toBeChecked();

    await page.getByLabel("Reset routing order").click();
    await expect(page.getByLabel("Move Brave Search up")).toBeDisabled();
  });
});
