import { describe, expect, it } from "vitest";

import { resolveThreadTabIconState } from "./ThreadStatusIndicators";
import type { ThreadStatusPill } from "./Sidebar.logic";

function status(label: ThreadStatusPill["label"], colorClass: string): ThreadStatusPill {
  return {
    label,
    colorClass,
    dotClass: "bg-current",
    pulse: label === "Working" || label === "Connecting",
  };
}

describe("resolveThreadTabIconState", () => {
  it("uses the normal thread icon when no status is active", () => {
    expect(
      resolveThreadTabIconState({
        status: null,
        interactionMode: "default",
      }),
    ).toMatchObject({
      kind: "normal",
      colorClass: "text-muted-foreground",
    });
  });

  it("uses plan colors for working plan-mode threads", () => {
    expect(
      resolveThreadTabIconState({
        status: status("Working", "text-sky-600"),
        interactionMode: "plan",
      }),
    ).toMatchObject({
      kind: "working",
      colorClass: "text-violet-600 dark:text-violet-300/90",
    });
  });

  it("keeps normal working colors for default-mode threads", () => {
    expect(
      resolveThreadTabIconState({
        status: status("Working", "text-sky-600"),
        interactionMode: "default",
      }),
    ).toMatchObject({
      kind: "working",
      colorClass: "text-sky-600",
    });
  });

  it.each([
    ["Pending Approval", "pending-approval"],
    ["Awaiting Input", "awaiting-input"],
    ["Plan Ready", "plan-ready"],
    ["Completed", "unread"],
  ] as const)("maps %s to the expected tab icon kind", (label, kind) => {
    expect(
      resolveThreadTabIconState({
        status: status(label, "text-status"),
        interactionMode: "default",
      }),
    ).toMatchObject({
      kind,
      colorClass: "text-status",
    });
  });
});
