import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { getProviderSummary } from "./providerStatus";

function provider(input: Partial<ServerProvider> & Pick<ServerProvider, "driver" | "instanceId">) {
  return {
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    version: input.version ?? "1.0.0",
    status: input.status ?? "ready",
    auth: input.auth ?? { status: "authenticated" },
    checkedAt: input.checkedAt ?? "2026-05-20T00:00:00.000Z",
    models: input.models ?? [],
    slashCommands: input.slashCommands ?? [],
    skills: input.skills ?? [],
    ...input,
  } satisfies ServerProvider;
}

describe("getProviderSummary", () => {
  it("surfaces service-mode task execution messaging for non-codex providers", () => {
    const summary = getProviderSummary(
      provider({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: ProviderDriverKind.make("claudeAgent"),
        taskExecution: {
          status: "unavailable",
          reason:
            "Unavailable in service mode. Only Codex task execution ships in the first version.",
        },
      }),
    );

    expect(summary.headline).toBe("Authenticated");
    expect(summary.detail).toContain("Unavailable in service mode");
  });

  it("prefers codex authentication/task-run setup guidance when codex is not ready", () => {
    const summary = getProviderSummary(
      provider({
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        auth: { status: "unauthenticated" },
        taskExecution: {
          status: "unavailable",
          reason:
            "Authenticate Codex before using it for background task execution in service mode.",
        },
      }),
    );

    expect(summary.headline).toBe("Not authenticated");
    expect(summary.detail).toContain("background task execution");
  });
});
