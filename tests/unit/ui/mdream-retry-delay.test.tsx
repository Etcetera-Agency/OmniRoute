// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => Object.assign((key: string) => key, { has: () => false }),
}));
vi.mock("@/shared/components", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/shared/components/Icon", () => ({ default: () => null }));
vi.mock("@/shared/components/Select", () => ({
  default: ({ disabled }: { disabled: boolean }) => <select disabled={disabled} />,
}));
vi.mock("@/store/notificationStore", () => ({
  useNotificationStore: () => ({ success: () => {}, error: () => {} }),
}));

const { default: ProviderRetryDelaySelect } =
  await import("@/app/(dashboard)/dashboard/providers/[id]/components/ProviderRetryDelaySelect");

it("enables the standard retry delay control for Mdream", async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const previous = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => Response.json({ providerQuotaOverrides: {} }));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ProviderRetryDelaySelect providerId="mdream" />));
    expect(container.querySelector("select")?.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
  }
});
