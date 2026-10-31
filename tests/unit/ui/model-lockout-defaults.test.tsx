// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModelLockoutCard from "@/app/(dashboard)/dashboard/settings/components/ModelLockoutCard";
import { DEFAULT_MODEL_LOCKOUT_SETTINGS } from "@/lib/resilience/modelLockoutSettings";

vi.mock("next-intl", () => {
  const translate = (key: string) => key;
  return { useTranslations: () => translate };
});

vi.mock("@/store/notificationStore", () => {
  const notifications = {
    error: vi.fn(),
    success: vi.fn(),
  };
  return { useNotificationStore: () => notifications };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ModelLockoutCard defaults", () => {
  it("uses the backend enabled default when the response omits enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ modelLockout: {} }), { status: 200 }))
    );

    render(<ModelLockoutCard />);

    const enabledSwitch = await screen.findByRole("switch", { name: "modelLockoutEnabled" });
    expect(enabledSwitch.getAttribute("aria-checked")).toBe(
      String(DEFAULT_MODEL_LOCKOUT_SETTINGS.enabled)
    );
  });

  it("keeps an explicit false until Reset defaults, then saves the backend default", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return new Response(JSON.stringify({ modelLockout: { enabled: true } }), { status: 200 });
        }
        return new Response(JSON.stringify({ modelLockout: { enabled: false } }), { status: 200 });
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ModelLockoutCard />);

    const enabledSwitch = await screen.findByRole("switch", { name: "modelLockoutEnabled" });
    expect(enabledSwitch.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "resetDefaults" }));
    expect(enabledSwitch.getAttribute("aria-checked")).toBe(
      String(DEFAULT_MODEL_LOCKOUT_SETTINGS.enabled)
    );

    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const saveRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(saveRequest.body)).modelLockout.enabled).toBe(
      DEFAULT_MODEL_LOCKOUT_SETTINGS.enabled
    );
  });
});
