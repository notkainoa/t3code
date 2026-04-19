import "../../index.css";

import { describe, expect, it } from "vitest";

describe("ExtensionManager import", () => {
  it("imports the module", async () => {
    const mod = await import("./ExtensionManager");
    expect(mod.PluginsDiscoverSettingsPage).toBeTypeOf("function");
    expect(mod.SkillsDiscoverSettingsPage).toBeTypeOf("function");
  });
});
