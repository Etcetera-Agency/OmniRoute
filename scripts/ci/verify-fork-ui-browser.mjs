import { chromium } from "playwright";

const baseUrl = process.env.UI_BASE_URL || "http://127.0.0.1:20128";
const password = process.env.INITIAL_PASSWORD;
if (!password) throw new Error("INITIAL_PASSWORD is required");

const browser = await chromium.launch({
  headless: false,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const failures = [];
  let staticResponses = 0;
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === baseUrl &&
      (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/api/auth/"))
    ) {
      failures.push(`request failed: ${url.pathname}`);
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== baseUrl) return;
    if (url.pathname.startsWith("/_next/static/")) staticResponses++;
    if (
      (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/api/auth/")) &&
      response.status() >= 400
    ) {
      failures.push(`HTTP ${response.status()}: ${url.pathname}`);
    }
  });

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill(password);
  const loginResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/login" &&
      response.request().method() === "POST"
  );
  await page.locator('button[type="submit"]').click();
  const login = await loginResponse;
  if (!login.ok()) throw new Error("login API failed");
  await page.waitForURL("**/dashboard", { timeout: 30000 });
  // Navigation can discard the response body; the session cookie proves login completed.
  const cookies = await page.context().cookies(baseUrl);
  if (!cookies.some((cookie) => cookie.name === "auth_token" && cookie.value)) {
    throw new Error("login did not establish a dashboard session");
  }
  await page.goto(`${baseUrl}/dashboard/providers`, { waitUntil: "domcontentloaded" });
  const card = page.getByRole("link", { name: /Mdream.*No API key required/i });
  await card.waitFor({ state: "visible", timeout: 30000 });
  await card.click();
  await page.waitForURL("**/dashboard/providers/mdream");
  await page.getByText("Mdream is available without an API key and returns Markdown.").waitFor();
  await page.getByRole("link", { name: "Open Web Fetch" }).click();
  await page.getByTestId("scrape-tab").waitFor({ state: "visible", timeout: 30000 });
  // The provider control is Radix, not a native select. Exercise its visible value
  // and change handler, then confirm the scrape form receives the selection.
  const provider = page.getByTestId("search-tools-config-pane").getByRole("combobox").first();
  await provider.getByText("Mdream", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await provider.click();
  await page.getByRole("option", { name: /auto/i }).click();
  await provider.click();
  await page.getByRole("option", { name: "Mdream", exact: true }).click();
  await provider.getByText("Mdream", { exact: true }).waitFor({ state: "visible" });
  await page
    .getByTestId("scrape-tab")
    .getByText("Provider:")
    .getByText("mdream", { exact: true })
    .waitFor({ state: "visible" });
  await page.getByTestId("url-input").fill("https://example.com/");
  const extraction = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search/fetch" &&
      response.request().method() === "POST"
  );
  await page.getByTestId("scrape-button").click();
  if (!(await extraction).ok()) throw new Error("Mdream extraction request failed");
  await page
    .getByText("Example Domain", { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  const version = await page.request.get(`${baseUrl}/api/system/version`);
  if (!version.ok() || (await version.json()).current !== "3.8.53") {
    throw new Error("running UI version is not 3.8.53");
  }
  if (!staticResponses) throw new Error("no Next static assets loaded");
  if (failures.length) throw new Error(failures.join("; "));
  console.log(JSON.stringify({ ok: true, version: "3.8.53", staticResponses }));
} finally {
  await browser.close();
}
