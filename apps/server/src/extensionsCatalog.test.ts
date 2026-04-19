import { describe, expect, it } from "vitest";

import { __internal } from "./extensionsCatalog";

describe("extensionsCatalog parsers", () => {
  it("parses top skills from the skills.sh homepage payload", () => {
    const html = `
      <script>
        self.__next_f.push([1,"{\\"skills\\":[{\\"source\\":\\"vercel-labs/skills\\",\\"skillId\\":\\"find-skills\\",\\"name\\":\\"find-skills\\",\\"installs\\":1104434},{\\"source\\":\\"anthropics/skills\\",\\"skillId\\":\\"frontend-design\\",\\"name\\":\\"frontend-design\\",\\"installs\\":313338}],\\"totalSkills\\":91009}"])
      </script>
    `;

    expect(__internal.parseSkillsHomepage(html)).toEqual([
      {
        source: "vercel-labs/skills",
        skillId: "find-skills",
        name: "find-skills",
        installs: 1104434,
      },
      {
        source: "anthropics/skills",
        skillId: "frontend-design",
        name: "frontend-design",
        installs: 313338,
      },
    ]);
  });

  it("parses repository listings from a skills.sh source page", () => {
    const html = `
      <div class="divide-y divide-border">
        <a href="/anthropics/claude-code/agent-development">
          <div><h3>agent development</h3></div>
          <div><span class="font-mono text-sm text-foreground">9.1K</span></div>
        </a>
        <a href="/anthropics/claude-code/plugin-structure">
          <div><h3>plugin structure</h3></div>
          <div><span class="font-mono text-sm text-foreground">5.7K</span></div>
        </a>
      </div>
    `;

    expect(__internal.parseSkillsRepositoryPage(html, "anthropics/claude-code")).toEqual([
      {
        source: "anthropics/claude-code",
        skillId: "agent-development",
        name: "agent development",
        installs: 9100,
      },
      {
        source: "anthropics/claude-code",
        skillId: "plugin-structure",
        name: "plugin structure",
        installs: 5700,
      },
    ]);
  });

  it("categorizes design and workflow oriented entries consistently", () => {
    expect(
      __internal.categorizeEntry({
        name: "frontend-design",
        source: "anthropics/skills",
      }),
    ).toBe("Design");

    expect(
      __internal.categorizeEntry({
        name: "plugin-structure",
        source: "anthropics/claude-code",
      }),
    ).toBe("Workflow");
  });
});
