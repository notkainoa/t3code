import { describe, expect, it } from "vitest";

import {
  applyWorkflowReload,
  parseWorkflowDefinition,
  renderWorkflowPrompt,
  resolveWorkflowConfig,
  WorkflowConfigEnvError,
  WorkflowFrontMatterParseError,
  WorkflowFrontMatterShapeError,
} from "./Workflow.ts";

const WORKFLOW_PATH = "/repo/WORKFLOW.md";

const TASK = {
  id: "task-1",
  projectId: "project-1",
  identifier: "ABC-123",
  title: "Implement board",
  description: "Build the board UI",
  column: "Todo",
  priority: 1,
  labels: ["ui", "board"],
  blockedBy: ["ABC-100"],
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
} as const;

describe("parseWorkflowDefinition", () => {
  it("parses files without front matter", () => {
    const definition = parseWorkflowDefinition({
      path: WORKFLOW_PATH,
      contents: "\nHello task runner.\n",
    });

    expect(definition).toEqual({
      path: WORKFLOW_PATH,
      config: {},
      promptTemplate: "Hello task runner.",
    });
  });

  it("parses valid YAML front matter", () => {
    const definition = parseWorkflowDefinition({
      path: WORKFLOW_PATH,
      contents: `---
tracker:
  kind: t3code
polling:
  interval_ms: 15000
---
Hello {{ task.identifier }}`,
    });

    if (definition instanceof Error) {
      throw definition;
    }

    expect(definition.config).toMatchObject({
      tracker: { kind: "t3code" },
      polling: { interval_ms: 15_000 },
    });
    expect(definition.promptTemplate).toBe("Hello {{ task.identifier }}");
  });

  it("returns a typed error for invalid YAML", () => {
    const definition = parseWorkflowDefinition({
      path: WORKFLOW_PATH,
      contents: `---
tracker:
  kind: [unterminated
---
Body`,
    });

    expect(definition).toBeInstanceOf(WorkflowFrontMatterParseError);
  });

  it("returns a typed error when front matter is not a map", () => {
    const definition = parseWorkflowDefinition({
      path: WORKFLOW_PATH,
      contents: `---
- one
- two
---
Body`,
    });

    expect(definition).toBeInstanceOf(WorkflowFrontMatterShapeError);
  });
});

describe("resolveWorkflowConfig", () => {
  it("applies defaults", () => {
    const resolved = resolveWorkflowConfig({
      workflowPath: WORKFLOW_PATH,
      rawConfig: {},
      homeDir: "/home/test",
      defaultWorkspaceRoot: "/var/lib/t3/workspaces",
    });

    if (resolved instanceof Error) {
      throw resolved;
    }

    expect(resolved).toMatchObject({
      tracker: {
        kind: "t3code",
        activeStates: ["Todo", "In Progress"],
        terminalStates: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"],
      },
      polling: { intervalMs: 30_000 },
      workspace: { root: "/var/lib/t3/workspaces" },
      hooks: { timeoutMs: 60_000 },
      agent: {
        maxConcurrentAgents: 3,
        maxTurns: 20,
        maxRetryBackoffMs: 300_000,
        maxConcurrentAgentsByState: {},
      },
      codex: {
        command: "codex app-server",
        turnTimeoutMs: 3_600_000,
        readTimeoutMs: 5_000,
        stallTimeoutMs: 300_000,
      },
      verification: {
        commands: [],
        screenshots: { enabled: false },
      },
    });
  });

  it("resolves env-backed fields and relative workspace roots", () => {
    const resolved = resolveWorkflowConfig({
      workflowPath: "/repo/.config/WORKFLOW.md",
      rawConfig: {
        workspace: { root: "$WORKSPACE_ROOT" },
        codex: { command: "$CODEX_COMMAND" },
      },
      env: {
        WORKSPACE_ROOT: "../workspaces",
        CODEX_COMMAND: "codex app-server --json",
      },
      homeDir: "/home/test",
      defaultWorkspaceRoot: "/fallback",
    });

    if (resolved instanceof Error) {
      throw resolved;
    }

    expect(resolved.workspace.root).toBe("/repo/workspaces");
    expect(resolved.codex.command).toBe("codex app-server --json");
  });

  it("expands ~ in workspace roots", () => {
    const resolved = resolveWorkflowConfig({
      workflowPath: WORKFLOW_PATH,
      rawConfig: {
        workspace: { root: "~/runner-workspaces" },
      },
      homeDir: "/home/tester",
    });

    if (resolved instanceof Error) {
      throw resolved;
    }

    expect(resolved.workspace.root).toBe("/home/tester/runner-workspaces");
  });

  it("fails when an env-backed field is missing", () => {
    const resolved = resolveWorkflowConfig({
      workflowPath: WORKFLOW_PATH,
      rawConfig: {
        workspace: { root: "$MISSING_ROOT" },
      },
      env: {},
    });

    expect(resolved).toBeInstanceOf(WorkflowConfigEnvError);
  });
});

describe("renderWorkflowPrompt", () => {
  it("renders task and attempt placeholders strictly", () => {
    const rendered = renderWorkflowPrompt({
      workflowPath: WORKFLOW_PATH,
      promptTemplate: "Task {{ task.identifier }} / {{ task.title }} / attempt {{ attempt }}",
      task: TASK,
      attempt: 2,
    });

    expect(rendered).toBe("Task ABC-123 / Implement board / attempt 2");
  });

  it("fails on unknown placeholders", () => {
    const rendered = renderWorkflowPrompt({
      workflowPath: WORKFLOW_PATH,
      promptTemplate: "Task {{ task.missing_field }}",
      task: TASK,
      attempt: null,
    });

    expect(rendered).toMatchObject({
      _tag: "WorkflowTemplateRenderError",
    });
  });
});

describe("applyWorkflowReload", () => {
  it("accepts valid reloads", () => {
    const previousDefinition = parseWorkflowDefinition({
      path: WORKFLOW_PATH,
      contents: "Old body",
    });
    if (previousDefinition instanceof Error) {
      throw previousDefinition;
    }
    const previousConfig = resolveWorkflowConfig({
      workflowPath: WORKFLOW_PATH,
      rawConfig: previousDefinition.config,
    });
    if (previousConfig instanceof Error) {
      throw previousConfig;
    }

    const nextDefinition = parseWorkflowDefinition({
      path: WORKFLOW_PATH,
      contents: `---
polling:
  interval_ms: 1000
---
New body`,
    });
    if (nextDefinition instanceof Error) {
      throw nextDefinition;
    }
    const nextConfig = resolveWorkflowConfig({
      workflowPath: WORKFLOW_PATH,
      rawConfig: nextDefinition.config,
    });
    if (nextConfig instanceof Error) {
      throw nextConfig;
    }

    const result = applyWorkflowReload({
      previous: {
        definition: previousDefinition,
        resolvedConfig: previousConfig,
      },
      nextDefinition,
      resolvedConfig: nextConfig,
    });

    expect(result.retainedPrevious).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.snapshot.definition.promptTemplate).toBe("New body");
    expect(result.snapshot.resolvedConfig.polling.intervalMs).toBe(1_000);
  });

  it("retains the last known good snapshot on invalid reloads", () => {
    const previousDefinition = parseWorkflowDefinition({
      path: WORKFLOW_PATH,
      contents: "Old body",
    });
    if (previousDefinition instanceof Error) {
      throw previousDefinition;
    }
    const previousConfig = resolveWorkflowConfig({
      workflowPath: WORKFLOW_PATH,
      rawConfig: previousDefinition.config,
    });
    if (previousConfig instanceof Error) {
      throw previousConfig;
    }

    const invalidDefinition = parseWorkflowDefinition({
      path: WORKFLOW_PATH,
      contents: `---
tracker: [broken
---
Body`,
    });

    const result = applyWorkflowReload({
      previous: {
        definition: previousDefinition,
        resolvedConfig: previousConfig,
      },
      nextDefinition: invalidDefinition,
      resolvedConfig: previousConfig,
    });

    expect(result.retainedPrevious).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.snapshot.definition.promptTemplate).toBe("Old body");
    expect(result.error).toBeInstanceOf(WorkflowFrontMatterParseError);
  });
});
