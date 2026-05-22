// @effect-diagnostics nodeBuiltinImport:off
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as Schema from "effect/Schema";

export class WorkflowFileMissingError extends Schema.TaggedErrorClass<WorkflowFileMissingError>()(
  "WorkflowFileMissingError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class WorkflowFrontMatterParseError extends Schema.TaggedErrorClass<WorkflowFrontMatterParseError>()(
  "WorkflowFrontMatterParseError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class WorkflowFrontMatterShapeError extends Schema.TaggedErrorClass<WorkflowFrontMatterShapeError>()(
  "WorkflowFrontMatterShapeError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class WorkflowTemplateRenderError extends Schema.TaggedErrorClass<WorkflowTemplateRenderError>()(
  "WorkflowTemplateRenderError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class WorkflowConfigEnvError extends Schema.TaggedErrorClass<WorkflowConfigEnvError>()(
  "WorkflowConfigEnvError",
  {
    path: Schema.String,
    field: Schema.String,
    envVar: Schema.String,
    message: Schema.String,
  },
) {}

export interface WorkflowDefinition {
  readonly path: string;
  readonly config: Record<string, unknown>;
  readonly promptTemplate: string;
}

export interface WorkflowTaskLike {
  readonly id: string;
  readonly projectId: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string | null;
  readonly column: string;
  readonly priority: number | null;
  readonly labels: readonly string[];
  readonly blockedBy: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowResolvedConfig {
  readonly tracker: {
    readonly kind: string;
    readonly activeStates: readonly string[];
    readonly terminalStates: readonly string[];
  };
  readonly polling: {
    readonly intervalMs: number;
  };
  readonly workspace: {
    readonly root: string;
  };
  readonly hooks: {
    readonly timeoutMs: number;
    readonly afterCreate: readonly string[];
    readonly beforeRun: readonly string[];
    readonly afterRun: readonly string[];
    readonly beforeRemove: readonly string[];
  };
  readonly agent: {
    readonly maxConcurrentAgents: number;
    readonly maxTurns: number;
    readonly maxRetryBackoffMs: number;
    readonly maxConcurrentAgentsByState: Readonly<Record<string, number>>;
  };
  readonly codex: {
    readonly command: string;
    readonly turnTimeoutMs: number;
    readonly readTimeoutMs: number;
    readonly stallTimeoutMs: number;
  };
  readonly verification: {
    readonly commands: readonly string[];
    readonly screenshots: {
      readonly enabled: boolean;
    };
  };
}

export interface ResolveWorkflowConfigOptions {
  readonly workflowPath: string;
  readonly rawConfig: Record<string, unknown>;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly defaultWorkspaceRoot?: string;
}

export interface WorkflowSnapshot {
  readonly definition: WorkflowDefinition;
  readonly resolvedConfig: WorkflowResolvedConfig;
}

export interface WorkflowReloadResult {
  readonly snapshot: WorkflowSnapshot;
  readonly changed: boolean;
  readonly retainedPrevious: boolean;
  readonly error: Error | null;
}

const DEFAULT_TRACKER_ACTIVE_STATES = ["Todo", "In Progress"] as const;
const DEFAULT_TRACKER_TERMINAL_STATES = [
  "Closed",
  "Cancelled",
  "Canceled",
  "Duplicate",
  "Done",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isWorkflowConfigEnvError = Schema.is(WorkflowConfigEnvError);

function countIndentation(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") {
    count += 1;
  }
  return count;
}

function parseYamlScalar(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value.length === 0) return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") || value.endsWith("]")) {
    if (!value.startsWith("[") || !value.endsWith("]")) {
      throw new Error(`Invalid inline array value '${value}'.`);
    }
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((entry) => parseYamlScalar(entry.trim()));
  }
  return value;
}

function parseSimpleYaml(source: string): unknown {
  const lines = source
    .split("\n")
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"));

  if (lines.length === 0) return {};
  if (lines[0]?.trimStart().startsWith("- ")) {
    throw new Error("Workflow front matter must decode to a YAML mapping/object.");
  }

  const parseBlock = (
    startIndex: number,
    expectedIndent: number,
  ): { readonly value: Record<string, unknown>; readonly nextIndex: number } => {
    const result: Record<string, unknown> = {};
    let index = startIndex;

    while (index < lines.length) {
      const line = lines[index]!;
      const indent = countIndentation(line);
      if (indent < expectedIndent) break;
      if (indent > expectedIndent) {
        throw new Error(`Unexpected indentation on line '${line.trim()}'.`);
      }

      const trimmed = line.trim();
      const separatorIndex = trimmed.indexOf(":");
      if (separatorIndex <= 0) {
        throw new Error(`Invalid mapping entry '${trimmed}'.`);
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();

      if (rawValue.length === 0) {
        const nextLine = lines[index + 1];
        if (!nextLine) {
          result[key] = {};
          index += 1;
          continue;
        }
        const nextIndent = countIndentation(nextLine);
        if (nextIndent <= indent) {
          result[key] = {};
          index += 1;
          continue;
        }
        const nested = parseBlock(index + 1, nextIndent);
        result[key] = nested.value;
        index = nested.nextIndex;
        continue;
      }

      result[key] = parseYamlScalar(rawValue);
      index += 1;
    }

    return { value: result, nextIndex: index };
  };

  return parseBlock(0, countIndentation(lines[0]!)).value;
}

function normalizeStringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeCommandArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function resolveEnvBackedString(input: {
  readonly value: unknown;
  readonly field: string;
  readonly workflowPath: string;
  readonly env: NodeJS.ProcessEnv;
}): string | WorkflowConfigEnvError | undefined {
  if (typeof input.value !== "string") return undefined;
  const trimmed = input.value.trim();
  if (trimmed.length === 0) return undefined;
  if (!trimmed.startsWith("$")) return trimmed;
  const envVar = trimmed.slice(1);
  const resolved = input.env[envVar];
  if (!resolved || resolved.trim().length === 0) {
    return new WorkflowConfigEnvError({
      path: input.workflowPath,
      field: input.field,
      envVar,
      message: `Missing environment variable ${envVar} for ${input.field}.`,
    });
  }
  return resolved.trim();
}

function expandHomeDir(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  return input;
}

function normalizeConcurrencyByState(value: unknown): Readonly<Record<string, number>> {
  if (!isPlainObject(value)) return {};
  const entries = Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .filter(([, limit]) => Number.isInteger(limit) && limit > 0);
  return Object.freeze(Object.fromEntries(entries));
}

export async function loadWorkflowDefinition(
  workflowPath: string,
): Promise<
  | WorkflowDefinition
  | WorkflowFileMissingError
  | WorkflowFrontMatterParseError
  | WorkflowFrontMatterShapeError
> {
  try {
    await access(workflowPath);
  } catch {
    return new WorkflowFileMissingError({
      path: workflowPath,
      message: `Workflow file not found: ${workflowPath}`,
    });
  }

  return parseWorkflowDefinition({
    path: workflowPath,
    contents: await readFile(workflowPath, "utf8"),
  });
}

export function parseWorkflowDefinition(input: {
  readonly path: string;
  readonly contents: string;
}): WorkflowDefinition | WorkflowFrontMatterParseError | WorkflowFrontMatterShapeError {
  const normalizedContents = input.contents.replace(/\r\n/g, "\n");
  if (!normalizedContents.startsWith("---\n")) {
    return {
      path: input.path,
      config: {},
      promptTemplate: normalizedContents.trim(),
    };
  }

  const closingIndex = normalizedContents.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return new WorkflowFrontMatterParseError({
      path: input.path,
      message: "Workflow front matter is missing a closing '---' delimiter.",
    });
  }

  const frontMatterSource = normalizedContents.slice(4, closingIndex);
  const promptTemplate = normalizedContents.slice(closingIndex + 5).trim();
  let parsed: unknown;
  try {
    parsed = parseSimpleYaml(frontMatterSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid workflow front matter YAML.";
    if (message === "Workflow front matter must decode to a YAML mapping/object.") {
      return new WorkflowFrontMatterShapeError({
        path: input.path,
        message,
      });
    }
    return new WorkflowFrontMatterParseError({
      path: input.path,
      message,
    });
  }

  if (parsed !== null && !isPlainObject(parsed)) {
    return new WorkflowFrontMatterShapeError({
      path: input.path,
      message: "Workflow front matter must decode to a YAML mapping/object.",
    });
  }

  return {
    path: input.path,
    config: parsed ?? {},
    promptTemplate,
  };
}

export function resolveWorkflowConfig(
  options: ResolveWorkflowConfigOptions,
): WorkflowResolvedConfig | WorkflowConfigEnvError {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const workflowDir = path.dirname(options.workflowPath);
  const defaultWorkspaceRoot =
    options.defaultWorkspaceRoot ?? path.join(workflowDir, ".t3code", "workspaces");

  const tracker = isPlainObject(options.rawConfig.tracker) ? options.rawConfig.tracker : {};
  const polling = isPlainObject(options.rawConfig.polling) ? options.rawConfig.polling : {};
  const workspace = isPlainObject(options.rawConfig.workspace) ? options.rawConfig.workspace : {};
  const hooks = isPlainObject(options.rawConfig.hooks) ? options.rawConfig.hooks : {};
  const agent = isPlainObject(options.rawConfig.agent) ? options.rawConfig.agent : {};
  const codex = isPlainObject(options.rawConfig.codex) ? options.rawConfig.codex : {};
  const verification = isPlainObject(options.rawConfig.verification)
    ? options.rawConfig.verification
    : {};
  const screenshots = isPlainObject(verification.screenshots) ? verification.screenshots : {};

  const resolvedWorkspaceRoot = resolveEnvBackedString({
    value: workspace.root,
    field: "workspace.root",
    workflowPath: options.workflowPath,
    env,
  });
  if (isWorkflowConfigEnvError(resolvedWorkspaceRoot)) {
    return resolvedWorkspaceRoot;
  }

  const resolvedCodexCommand = resolveEnvBackedString({
    value: codex.command,
    field: "codex.command",
    workflowPath: options.workflowPath,
    env,
  });
  if (isWorkflowConfigEnvError(resolvedCodexCommand)) {
    return resolvedCodexCommand;
  }

  const workspaceRoot = expandHomeDir(resolvedWorkspaceRoot ?? defaultWorkspaceRoot, homeDir);
  const codexCommand = resolvedCodexCommand ?? "codex app-server";

  return {
    tracker: {
      kind:
        typeof tracker.kind === "string" && tracker.kind.trim().length > 0
          ? tracker.kind
          : "t3code",
      activeStates: normalizeStringArray(tracker.active_states, DEFAULT_TRACKER_ACTIVE_STATES),
      terminalStates: normalizeStringArray(
        tracker.terminal_states,
        DEFAULT_TRACKER_TERMINAL_STATES,
      ),
    },
    polling: {
      intervalMs: normalizePositiveInt(polling.interval_ms, 30_000),
    },
    workspace: {
      root: path.isAbsolute(workspaceRoot)
        ? workspaceRoot
        : path.resolve(workflowDir, workspaceRoot),
    },
    hooks: {
      timeoutMs: normalizePositiveInt(hooks.timeout_ms, 60_000),
      afterCreate: normalizeCommandArray(hooks.after_create),
      beforeRun: normalizeCommandArray(hooks.before_run),
      afterRun: normalizeCommandArray(hooks.after_run),
      beforeRemove: normalizeCommandArray(hooks.before_remove),
    },
    agent: {
      maxConcurrentAgents: normalizePositiveInt(agent.max_concurrent_agents, 3),
      maxTurns: normalizePositiveInt(agent.max_turns, 20),
      maxRetryBackoffMs: normalizePositiveInt(agent.max_retry_backoff_ms, 300_000),
      maxConcurrentAgentsByState: normalizeConcurrencyByState(agent.max_concurrent_agents_by_state),
    },
    codex: {
      command: codexCommand,
      turnTimeoutMs: normalizePositiveInt(codex.turn_timeout_ms, 3_600_000),
      readTimeoutMs: normalizePositiveInt(codex.read_timeout_ms, 5_000),
      stallTimeoutMs: normalizeNonNegativeInt(codex.stall_timeout_ms, 300_000),
    },
    verification: {
      commands: normalizeCommandArray(verification.commands),
      screenshots: {
        enabled: screenshots.enabled === true,
      },
    },
  };
}

export function renderWorkflowPrompt(input: {
  readonly workflowPath: string;
  readonly promptTemplate: string;
  readonly task: WorkflowTaskLike;
  readonly attempt: number | null;
}): string | WorkflowTemplateRenderError {
  const context = {
    task: input.task,
    attempt: input.attempt,
  } as const;

  const rendered = input.promptTemplate.replaceAll(/\{\{\s*([^}]+?)\s*\}\}/g, (match, rawPath) => {
    const pathSegments = rawPath
      .split(".")
      .map((segment: string) => segment.trim())
      .filter((segment: string) => segment.length > 0);

    let current: unknown = context;
    for (const segment of pathSegments) {
      if (!isPlainObject(current) && !Array.isArray(current)) {
        return `__WORKFLOW_TEMPLATE_ERROR__${match}`;
      }
      current = (current as Record<string, unknown>)[segment];
    }

    if (current === undefined) {
      return `__WORKFLOW_TEMPLATE_ERROR__${match}`;
    }
    if (current === null) {
      return "";
    }
    if (
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      return String(current);
    }
    return JSON.stringify(current);
  });

  const unresolved = rendered.match(/__WORKFLOW_TEMPLATE_ERROR__(\{\{.+?\}\})/);
  if (unresolved) {
    return new WorkflowTemplateRenderError({
      path: input.workflowPath,
      message: `Unknown workflow template expression ${unresolved[1]}.`,
    });
  }
  return rendered;
}

export function applyWorkflowReload(input: {
  readonly previous: WorkflowSnapshot;
  readonly nextDefinition:
    | WorkflowDefinition
    | WorkflowFileMissingError
    | WorkflowFrontMatterParseError
    | WorkflowFrontMatterShapeError;
  readonly resolvedConfig: WorkflowResolvedConfig | WorkflowConfigEnvError;
}): WorkflowReloadResult {
  if (input.nextDefinition instanceof Error) {
    return {
      snapshot: input.previous,
      changed: false,
      retainedPrevious: true,
      error: input.nextDefinition,
    };
  }

  if (input.resolvedConfig instanceof Error) {
    return {
      snapshot: input.previous,
      changed: false,
      retainedPrevious: true,
      error: input.resolvedConfig,
    };
  }

  const nextSnapshot: WorkflowSnapshot = {
    definition: input.nextDefinition,
    resolvedConfig: input.resolvedConfig,
  };

  const changed =
    JSON.stringify(input.previous.definition) !== JSON.stringify(nextSnapshot.definition) ||
    JSON.stringify(input.previous.resolvedConfig) !== JSON.stringify(nextSnapshot.resolvedConfig);

  return {
    snapshot: nextSnapshot,
    changed,
    retainedPrevious: false,
    error: null,
  };
}
