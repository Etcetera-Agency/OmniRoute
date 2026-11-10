// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/shared/components/SegmentedControl", () => ({
  default: ({ options }: { options: Array<{ value: string; label: string }> }) => (
    <div role="tablist">
      {options.map((option) => (
        <button role="tab" key={option.value}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

const { ServiceKindTabs } =
  await import("@/app/(dashboard)/dashboard/media-providers/components/ServiceKindTabs");

it("shows the requested single Web Fetch tab without changing the default", async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(<ServiceKindTabs kinds={["webFetch"]} activeKind="webFetch" onSelect={() => {}} />)
  );
  expect(container.querySelector('[role="tab"]')).toBeNull();
  await act(async () =>
    root.render(
      <ServiceKindTabs kinds={["webFetch"]} activeKind="webFetch" onSelect={() => {}} showSingle />
    )
  );
  expect(container.querySelector('[role="tab"]')?.textContent).toBe("kinds.webFetch");
  await act(async () => root.unmount());
});
