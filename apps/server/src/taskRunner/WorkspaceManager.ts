import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ProcessRunner, ProcessTimeoutError } from "../processRunner.ts";
import {
  WorkspacePaths,
  WorkspaceRootCreateFailedError,
  WorkspaceRootNotDirectoryError,
  WorkspaceRootNotExistsError,
} from "../workspace/Services/WorkspacePaths.ts";

export class TaskWorkspacePathOutsideRootError extends Schema.TaggedErrorClass<TaskWorkspacePathOutsideRootError>()(
  "TaskWorkspacePathOutsideRootError",
  {
    workspaceRoot: Schema.String,
    taskIdentifier: Schema.String,
    workspacePath: Schema.String,
    message: Schema.String,
  },
) {}

export class TaskWorkspaceCreateError extends Schema.TaggedErrorClass<TaskWorkspaceCreateError>()(
  "TaskWorkspaceCreateError",
  {
    workspaceRoot: Schema.String,
    taskIdentifier: Schema.String,
    workspacePath: Schema.String,
    message: Schema.String,
  },
) {}

export class TaskWorkspaceHookError extends Schema.TaggedErrorClass<TaskWorkspaceHookError>()(
  "TaskWorkspaceHookError",
  {
    hookKind: Schema.String,
    command: Schema.String,
    cwd: Schema.String,
    message: Schema.String,
  },
) {}

export class TaskWorkspaceHookTimeoutError extends Schema.TaggedErrorClass<TaskWorkspaceHookTimeoutError>()(
  "TaskWorkspaceHookTimeoutError",
  {
    hookKind: Schema.String,
    command: Schema.String,
    cwd: Schema.String,
    timeoutMs: Schema.Number,
    message: Schema.String,
  },
) {}

export class TaskWorkspaceCwdMismatchError extends Schema.TaggedErrorClass<TaskWorkspaceCwdMismatchError>()(
  "TaskWorkspaceCwdMismatchError",
  {
    expectedCwd: Schema.String,
    actualCwd: Schema.String,
    message: Schema.String,
  },
) {}

export interface TaskWorkspaceHookConfig {
  readonly timeoutMs: number;
  readonly afterCreate: readonly string[];
  readonly beforeRun: readonly string[];
  readonly afterRun: readonly string[];
  readonly beforeRemove: readonly string[];
}

export interface PreparedTaskWorkspace {
  readonly workspaceRoot: string;
  readonly workspacePath: string;
  readonly workspaceKey: string;
  readonly createdNow: boolean;
}

export interface TaskWorkspaceManagerShape {
  readonly sanitizeTaskWorkspaceKey: (taskIdentifier: string) => string;
  readonly prepareWorkspace: (input: {
    readonly workspaceRoot: string;
    readonly taskIdentifier: string;
    readonly hooks: TaskWorkspaceHookConfig;
  }) => Effect.Effect<
    PreparedTaskWorkspace,
    | WorkspaceRootNotExistsError
    | WorkspaceRootCreateFailedError
    | WorkspaceRootNotDirectoryError
    | TaskWorkspacePathOutsideRootError
    | TaskWorkspaceCreateError
    | TaskWorkspaceHookError
    | TaskWorkspaceHookTimeoutError
  >;
  readonly runBeforeRunHooks: (input: {
    readonly workspacePath: string;
    readonly hooks: TaskWorkspaceHookConfig;
  }) => Effect.Effect<void, TaskWorkspaceHookError | TaskWorkspaceHookTimeoutError>;
  readonly runAfterRunHooks: (input: {
    readonly workspacePath: string;
    readonly hooks: TaskWorkspaceHookConfig;
  }) => Effect.Effect<void, never>;
  readonly removeWorkspace: (input: {
    readonly workspacePath: string;
    readonly hooks: TaskWorkspaceHookConfig;
  }) => Effect.Effect<void, never>;
  readonly assertWorkspaceCwd: (input: {
    readonly expectedWorkspacePath: string;
    readonly cwd: string;
  }) => Effect.Effect<void, TaskWorkspaceCwdMismatchError>;
}

export class TaskWorkspaceManager extends Context.Service<
  TaskWorkspaceManager,
  TaskWorkspaceManagerShape
>()("t3/taskRunner/TaskWorkspaceManager") {}

export function sanitizeTaskWorkspaceKey(taskIdentifier: string): string {
  const trimmed = taskIdentifier.trim();
  const replaced = trimmed.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  return replaced.length > 0 ? replaced : "task";
}

function normalizeShellOutput(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 0 ? trimmed : "Hook command failed.";
}

export const makeTaskWorkspaceManager = Effect.gen(function* () {
  const workspacePaths = yield* WorkspacePaths;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner;

  const runHookCommands = Effect.fn("TaskWorkspaceManager.runHookCommands")(function* (input: {
    readonly hookKind: "after_create" | "before_run" | "after_run" | "before_remove";
    readonly commands: readonly string[];
    readonly cwd: string;
    readonly timeoutMs: number;
  }) {
    for (const command of input.commands) {
      const result = yield* processRunner
        .run({
          command: "bash",
          args: ["-lc", command],
          cwd: input.cwd,
          timeout: `${input.timeoutMs} millis`,
        })
        .pipe(
          Effect.mapError((error) => {
            if (error instanceof ProcessTimeoutError) {
              return new TaskWorkspaceHookTimeoutError({
                hookKind: input.hookKind,
                command,
                cwd: input.cwd,
                timeoutMs: input.timeoutMs,
                message: `Hook '${input.hookKind}' timed out after ${input.timeoutMs}ms.`,
              });
            }

            return new TaskWorkspaceHookError({
              hookKind: input.hookKind,
              command,
              cwd: input.cwd,
              message: error instanceof Error ? error.message : String(error),
            });
          }),
        );

      if (result.code !== 0) {
        return yield* new TaskWorkspaceHookError({
          hookKind: input.hookKind,
          command,
          cwd: input.cwd,
          message: normalizeShellOutput(result.stderr || result.stdout),
        });
      }
    }
  });

  const prepareWorkspace: TaskWorkspaceManagerShape["prepareWorkspace"] = Effect.fn(
    "TaskWorkspaceManager.prepareWorkspace",
  )(function* (input) {
    const workspaceRoot = yield* workspacePaths.normalizeWorkspaceRoot(input.workspaceRoot, {
      createIfMissing: true,
    });
    const workspaceKey = sanitizeTaskWorkspaceKey(input.taskIdentifier);
    const workspacePath = path.resolve(workspaceRoot, workspaceKey);
    const relativeToRoot = path.relative(workspaceRoot, workspacePath);
    if (
      relativeToRoot.length === 0 ||
      relativeToRoot === "." ||
      relativeToRoot === ".." ||
      relativeToRoot.startsWith("../") ||
      path.isAbsolute(relativeToRoot)
    ) {
      return yield* new TaskWorkspacePathOutsideRootError({
        workspaceRoot,
        taskIdentifier: input.taskIdentifier,
        workspacePath,
        message: `Task workspace path escaped workspace root: ${workspacePath}`,
      });
    }

    const beforeStat = yield* fileSystem
      .stat(workspacePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    const createdNow = beforeStat === null;
    if (createdNow) {
      yield* fileSystem.makeDirectory(workspacePath, { recursive: true }).pipe(
        Effect.mapError(
          (error) =>
            new TaskWorkspaceCreateError({
              workspaceRoot,
              taskIdentifier: input.taskIdentifier,
              workspacePath,
              message: error instanceof Error ? error.message : String(error),
            }),
        ),
      );
      yield* runHookCommands({
        hookKind: "after_create",
        commands: input.hooks.afterCreate,
        cwd: workspacePath,
        timeoutMs: input.hooks.timeoutMs,
      });
    }

    return {
      workspaceRoot,
      workspacePath,
      workspaceKey,
      createdNow,
    } satisfies PreparedTaskWorkspace;
  });

  const runBeforeRunHooks: TaskWorkspaceManagerShape["runBeforeRunHooks"] = Effect.fn(
    "TaskWorkspaceManager.runBeforeRunHooks",
  )(function* (input) {
    yield* runHookCommands({
      hookKind: "before_run",
      commands: input.hooks.beforeRun,
      cwd: input.workspacePath,
      timeoutMs: input.hooks.timeoutMs,
    });
  });

  const runAfterRunHooks: TaskWorkspaceManagerShape["runAfterRunHooks"] = Effect.fn(
    "TaskWorkspaceManager.runAfterRunHooks",
  )(function* (input) {
    yield* runHookCommands({
      hookKind: "after_run",
      commands: input.hooks.afterRun,
      cwd: input.workspacePath,
      timeoutMs: input.hooks.timeoutMs,
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Task workspace after_run hook failed", {
          error,
          cwd: input.workspacePath,
        }),
      ),
    );
  });

  const removeWorkspace: TaskWorkspaceManagerShape["removeWorkspace"] = Effect.fn(
    "TaskWorkspaceManager.removeWorkspace",
  )(function* (input) {
    yield* runHookCommands({
      hookKind: "before_remove",
      commands: input.hooks.beforeRemove,
      cwd: input.workspacePath,
      timeoutMs: input.hooks.timeoutMs,
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Task workspace before_remove hook failed", {
          error,
          cwd: input.workspacePath,
        }),
      ),
    );

    yield* fileSystem.remove(input.workspacePath, { recursive: true }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Task workspace removal failed", {
          error,
          cwd: input.workspacePath,
        }),
      ),
    );
  });

  const assertWorkspaceCwd: TaskWorkspaceManagerShape["assertWorkspaceCwd"] = Effect.fn(
    "TaskWorkspaceManager.assertWorkspaceCwd",
  )(function* (input) {
    const expectedCwd = path.resolve(input.expectedWorkspacePath);
    const actualCwd = path.resolve(input.cwd);
    if (expectedCwd !== actualCwd) {
      return yield* new TaskWorkspaceCwdMismatchError({
        expectedCwd,
        actualCwd,
        message: `Task run cwd mismatch. Expected ${expectedCwd}, received ${actualCwd}.`,
      });
    }
  });

  return TaskWorkspaceManager.of({
    sanitizeTaskWorkspaceKey,
    prepareWorkspace,
    runBeforeRunHooks,
    runAfterRunHooks,
    removeWorkspace,
    assertWorkspaceCwd,
  });
});

export const TaskWorkspaceManagerLive = Layer.effect(
  TaskWorkspaceManager,
  makeTaskWorkspaceManager,
);
