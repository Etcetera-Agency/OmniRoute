// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/shared/components/Input", () => ({
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("@/shared/components/Select", () => ({ default: () => <span>format selector</span> }));
vi.mock("@/app/(dashboard)/dashboard/providers/hooks/useApiKey", () => ({
  useApiKey: () => {
    throw new Error("Mdream must not read API keys");
  },
}));
vi.mock("@/app/(dashboard)/dashboard/media-providers/components/PlaygroundCard", () => ({
  PlaygroundCard: ({
    children,
    onRun,
    result,
  }: {
    children: React.ReactNode;
    onRun: () => void;
    result?: { data: unknown };
  }) => (
    <div>
      {children}
      <button onClick={onRun}>Run</button>
      {result && <pre>{JSON.stringify(result.data)}</pre>}
    </div>
  ),
}));

const { WebFetchExampleCard } =
  await import("@/app/(dashboard)/dashboard/media-providers/components/WebFetchExampleCard");
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

it("runs Mdream with the dashboard session without loading keys or creating a connection", async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ provider: "mdream", content: "Example Domain" });
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<WebFetchExampleCard providerId="mdream" />));
  expect(container.querySelector("input")?.value).toBe("https://example.com");
  expect(container.textContent).not.toContain("format selector");
  await act(async () => {
    container.querySelector("button")!.click();
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("/api/search/fetch");
  expect(calls[0].init?.credentials).toBe("same-origin");
  expect(calls[0].init?.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({
    url: "https://example.com",
    provider: "mdream",
    format: "markdown",
  });
  expect(container.textContent).toContain("Example Domain");
  await act(async () => root.unmount());
});
