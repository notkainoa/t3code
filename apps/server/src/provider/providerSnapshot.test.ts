import { describe, expect, it } from "vitest";
import { ProviderDriverKind, type ModelCapabilities } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import { buildServerProvider, providerModelsFromSettings } from "./providerSnapshot.ts";

const OPENCODE_CUSTOM_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "variant",
      label: "Reasoning",
      type: "select",
      options: [{ id: "medium", label: "Medium", isDefault: true }],
      currentValue: "medium",
    },
    {
      id: "agent",
      label: "Agent",
      type: "select",
      options: [{ id: "build", label: "Build", isDefault: true }],
      currentValue: "build",
    },
  ],
});

describe("providerModelsFromSettings", () => {
  it("applies the provided capabilities to custom models", () => {
    const models = providerModelsFromSettings(
      [],
      ProviderDriverKind.make("opencode"),
      ["openai/gpt-5"],
      OPENCODE_CUSTOM_MODEL_CAPABILITIES,
    );

    expect(models).toEqual([
      {
        slug: "openai/gpt-5",
        name: "openai/gpt-5",
        isCustom: true,
        capabilities: OPENCODE_CUSTOM_MODEL_CAPABILITIES,
      },
    ]);
  });
});

describe("buildServerProvider", () => {
  it("marks codex as runnable for task execution when it is authenticated", () => {
    const snapshot = buildServerProvider({
      driver: ProviderDriverKind.make("codex"),
      presentation: { displayName: "Codex" },
      enabled: true,
      checkedAt: "2026-05-20T00:00:00.000Z",
      models: [],
      probe: {
        installed: true,
        version: "1.0.0",
        status: "ready",
        auth: { status: "authenticated" },
      },
    });

    expect(snapshot.taskExecution).toEqual({ status: "runnable" });
  });

  it("marks non-codex providers as unavailable for task execution in service mode", () => {
    const snapshot = buildServerProvider({
      driver: ProviderDriverKind.make("claudeAgent"),
      presentation: { displayName: "Claude Code" },
      enabled: true,
      checkedAt: "2026-05-20T00:00:00.000Z",
      models: [],
      probe: {
        installed: true,
        version: "1.0.0",
        status: "ready",
        auth: { status: "authenticated" },
      },
    });

    expect(snapshot.taskExecution).toEqual({
      status: "unavailable",
      reason: "Unavailable in service mode. Only Codex task execution ships in the first version.",
    });
  });
});
