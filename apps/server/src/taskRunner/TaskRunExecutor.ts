import {
  CodexSettings,
  ProjectTask,
  ProjectTaskArtifact,
  ProjectTaskBoardError,
  ProjectTaskRun,
  ProjectTaskRunTokenUsage,
  ProjectTaskVerificationSummary,
  ProviderDriverKind,
  ProviderEvent,
  ProviderInstanceId,
  ThreadId,
  type CodexSettings as CodexSettingsType,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  type CodexSessionRuntimeOptions,
  makeCodexSessionRuntime,
} from "../provider/Layers/CodexSessionRuntime.ts";
import {
  materializeCodexShadowHome,
  resolveCodexHomeLayout,
} from "../provider/Drivers/CodexHomeLayout.ts";
import { ProcessRunner } from "../processRunner.ts";
import { ProjectTaskRunRepository } from "../persistence/Services/ProjectTaskRuns.ts";
import { ProjectTaskRepository } from "../persistence/Services/ProjectTasks.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  type WorkflowResolvedConfig,
  type WorkflowTaskLike,
  loadWorkflowDefinition,
  renderWorkflowPrompt,
  resolveWorkflowConfig,
} from "./Workflow.ts";
import { TaskWorkspaceManager } from "./WorkspaceManager.ts";

export interface TaskRunExecutorShape {
  readonly enqueueRun: (input: {
    readonly runId: ProjectTaskRun["id"];
    readonly instanceId?: ProviderInstanceId | undefined;
  }) => Effect.Effect<void, never>;
  readonly cancelRun: (runId: ProjectTaskRun["id"]) => Effect.Effect<void, never>;
}

export class TaskRunExecutor extends Context.Service<TaskRunExecutor, TaskRunExecutorShape>()(
  "t3/taskRunner/TaskRunExecutor",
) {}

type TaskRunCodexRuntimeEffect = ReturnType<typeof makeCodexSessionRuntime>;

export interface TaskRunCodexRuntimeFactoryShape {
  readonly make: (options: CodexSessionRuntimeOptions) => TaskRunCodexRuntimeEffect;
}

export class TaskRunCodexRuntimeFactory extends Context.Service<
  TaskRunCodexRuntimeFactory,
  TaskRunCodexRuntimeFactoryShape
>()("t3/taskRunner/TaskRunCodexRuntimeFactory") {}

const decodeCodexSettings = Schema.decodeUnknownSync(CodexSettings);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toProjectTaskBoardError(message: string) {
  return (cause: unknown) =>
    new ProjectTaskBoardError({
      message,
      cause,
    });
}

function toWorkflowTaskLike(task: ProjectTask): WorkflowTaskLike {
  return {
    id: task.id,
    projectId: task.projectId,
    identifier: task.identifier,
    title: task.title,
    description: task.description,
    column: task.column,
    priority: null,
    labels: task.labels,
    blockedBy: task.blockedBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function maybeTokenUsageFromEvent(event: ProviderEvent): ProjectTaskRunTokenUsage | null {
  const payload = event.payload;
  if (!isPlainObject(payload)) return null;
  const tokenUsage = payload.tokenUsage;
  if (!isPlainObject(tokenUsage)) return null;

  const inputTokens =
    typeof tokenUsage.inputTokens === "number"
      ? tokenUsage.inputTokens
      : typeof tokenUsage.lastInputTokens === "number"
        ? tokenUsage.lastInputTokens
        : 0;
  const outputTokens =
    typeof tokenUsage.outputTokens === "number"
      ? tokenUsage.outputTokens
      : typeof tokenUsage.lastOutputTokens === "number"
        ? tokenUsage.lastOutputTokens
        : 0;
  const totalTokens =
    typeof tokenUsage.totalProcessedTokens === "number"
      ? tokenUsage.totalProcessedTokens
      : typeof tokenUsage.usedTokens === "number"
        ? tokenUsage.usedTokens
        : inputTokens + outputTokens;

  return {
    inputTokens: Math.max(0, Math.trunc(inputTokens)),
    outputTokens: Math.max(0, Math.trunc(outputTokens)),
    totalTokens: Math.max(0, Math.trunc(totalTokens)),
  };
}

function resolveCodexExecutionSettings(input: {
  readonly settings: ServerSettings;
  readonly instanceId?: ProviderInstanceId | undefined;
}): {
  readonly instanceId: ProviderInstanceId;
  readonly codexSettings: CodexSettingsType;
  readonly environment: NodeJS.ProcessEnv | undefined;
  readonly model: string | undefined;
} {
  const instanceId = input.instanceId ?? ProviderInstanceId.make("codex");
  const instanceConfig = input.settings.providerInstances[instanceId];
  const base = input.settings.providers.codex;

  if (!instanceConfig || instanceConfig.driver !== ProviderDriverKind.make("codex")) {
    return {
      instanceId,
      codexSettings: base,
      environment: undefined,
      model:
        input.settings.textGenerationModelSelection.instanceId === instanceId
          ? input.settings.textGenerationModelSelection.model
          : undefined,
    };
  }

  const merged = decodeCodexSettings({
    ...base,
    ...(isPlainObject(instanceConfig.config) ? instanceConfig.config : {}),
    ...(instanceConfig.enabled !== undefined ? { enabled: instanceConfig.enabled } : {}),
  });

  return {
    instanceId,
    codexSettings: merged,
    environment: instanceConfig.environment
      ? Object.fromEntries(
          instanceConfig.environment.map(
            (entry: { readonly name: string; readonly value: string }) => [entry.name, entry.value],
          ),
        )
      : undefined,
    model:
      input.settings.textGenerationModelSelection.instanceId === instanceId
        ? input.settings.textGenerationModelSelection.model
        : undefined,
  };
}

const makeTaskRunExecutor = Effect.gen(function* () {
  const tasks = yield* ProjectTaskRepository;
  const runs = yield* ProjectTaskRunRepository;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettingsService;
  const processRunner = yield* ProcessRunner;
  const workspaceManager = yield* TaskWorkspaceManager;
  const runtimeFactory = yield* TaskRunCodexRuntimeFactory;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const backgroundScope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(backgroundScope, Exit.void));
  const runningFibersRef = yield* Ref.make(
    new Map<ProjectTaskRun["id"], Fiber.Fiber<void, ProjectTaskBoardError>>(),
  );

  const updateTaskAndRun = Effect.fn("TaskRunExecutor.updateTaskAndRun")(function* (input: {
    readonly taskId: ProjectTask["id"];
    readonly runId: ProjectTaskRun["id"];
    readonly mutateTask: (task: ProjectTask) => ProjectTask;
    readonly mutateRun: (run: ProjectTaskRun) => ProjectTaskRun;
  }) {
    const taskOption = yield* tasks
      .getById({ taskId: input.taskId })
      .pipe(Effect.mapError(toProjectTaskBoardError("Failed to read task state.")));
    const runOption = yield* runs
      .getById({ runId: input.runId })
      .pipe(Effect.mapError(toProjectTaskBoardError("Failed to read task run state.")));

    if (Option.isNone(taskOption) || Option.isNone(runOption)) {
      return;
    }

    yield* tasks
      .upsert(input.mutateTask(taskOption.value))
      .pipe(Effect.mapError(toProjectTaskBoardError("Failed to update task state.")));
    yield* runs
      .upsert(input.mutateRun(runOption.value))
      .pipe(Effect.mapError(toProjectTaskBoardError("Failed to update task run state.")));
  });

  const writeRunArtifacts = Effect.fn("TaskRunExecutor.writeRunArtifacts")(function* (input: {
    readonly run: ProjectTaskRun;
    readonly verification: ProjectTaskVerificationSummary | null;
    readonly logLines: ReadonlyArray<string>;
  }) {
    if (input.run.workspacePath === null) {
      return {
        artifacts: [] as ReadonlyArray<ProjectTaskArtifact>,
        verification: input.verification,
      };
    }

    const artifactsDir = path.join(input.run.workspacePath, ".t3code", "task-runs", input.run.id);
    yield* fileSystem
      .makeDirectory(artifactsDir, { recursive: true })
      .pipe(
        Effect.mapError(toProjectTaskBoardError("Failed to create task-run artifact directory.")),
      );

    const runnerLogPath = path.join(artifactsDir, "runner.log");
    yield* fileSystem
      .writeFileString(runnerLogPath, `${input.logLines.join("\n")}\n`)
      .pipe(Effect.mapError(toProjectTaskBoardError("Failed to write task-run log artifact.")));

    const artifacts: Array<ProjectTaskArtifact> = [
      {
        id: `${input.run.id}:runner-log`,
        kind: "log",
        label: "Runner log",
        path: runnerLogPath,
        createdAt: yield* nowIso,
      },
    ];

    if (input.verification !== null) {
      const verificationPath = path.join(artifactsDir, "verification.json");
      const verificationLines = [
        `status: ${input.verification.status}`,
        ...input.verification.commands.map(
          (command) =>
            `command: ${command.command}\nstatus: ${command.status}\ndetail: ${command.detail ?? ""}`,
        ),
      ];
      yield* fileSystem
        .writeFileString(verificationPath, `${verificationLines.join("\n\n")}\n`)
        .pipe(Effect.mapError(toProjectTaskBoardError("Failed to write verification artifact.")));
      artifacts.push({
        id: `${input.run.id}:verification`,
        kind: "report",
        label: "Verification report",
        path: verificationPath,
        createdAt: yield* nowIso,
      });
    }

    return {
      artifacts,
      verification: input.verification,
    };
  });

  const runVerification = Effect.fn("TaskRunExecutor.runVerification")(function* (input: {
    readonly workspacePath: string;
    readonly workflow: WorkflowResolvedConfig;
  }) {
    if (input.workflow.verification.commands.length === 0) {
      return null;
    }

    const commands: Array<ProjectTaskVerificationSummary["commands"][number]> = [];
    for (const command of input.workflow.verification.commands) {
      const result = yield* processRunner
        .run({
          command: "bash",
          args: ["-lc", command],
          cwd: input.workspacePath,
          timeout: Math.max(
            input.workflow.hooks.timeoutMs,
            Math.min(input.workflow.codex.turnTimeoutMs, 15 * 60_000),
          ),
          outputMode: "truncate",
          truncatedMarker: "\n...[truncated]",
        })
        .pipe(
          Effect.catch((error) =>
            Effect.succeed({
              stdout: "",
              stderr: errorMessage(error),
              code: 1,
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
            }),
          ),
        );

      commands.push({
        command,
        status: result.code === 0 ? "passed" : "failed",
        detail: (result.stderr || result.stdout).trim() || null,
      });
    }

    return {
      status: commands.every((command) => command.status === "passed") ? "passed" : "failed",
      commands,
      screenshots: [],
    } satisfies ProjectTaskVerificationSummary;
  });

  const executeRun = Effect.fn("TaskRunExecutor.executeRun")(function* (input: {
    readonly runId: ProjectTaskRun["id"];
    readonly instanceId?: ProviderInstanceId | undefined;
  }) {
    yield* Effect.gen(function* () {
      const runOption = yield* runs
        .getById({ runId: input.runId })
        .pipe(Effect.mapError(toProjectTaskBoardError("Failed to read task run.")));
      if (Option.isNone(runOption)) {
        return;
      }
      const taskOption = yield* tasks
        .getById({ taskId: runOption.value.taskId })
        .pipe(Effect.mapError(toProjectTaskBoardError("Failed to read task.")));
      if (Option.isNone(taskOption)) {
        return;
      }

      const run = runOption.value;
      const task = taskOption.value;
      const projectOption = yield* projectionSnapshotQuery
        .getProjectShellById(task.projectId)
        .pipe(Effect.mapError(toProjectTaskBoardError("Failed to resolve project workspace.")));
      if (Option.isNone(projectOption)) {
        return yield* new ProjectTaskBoardError({
          message: `Project ${task.projectId} is unavailable for task execution.`,
        });
      }

      const workflowPath = path.join(projectOption.value.workspaceRoot, "WORKFLOW.md");
      const workflowDefinition = yield* Effect.promise(() => loadWorkflowDefinition(workflowPath));
      if (workflowDefinition instanceof Error) {
        return yield* workflowDefinition;
      }

      const workflow = resolveWorkflowConfig({
        workflowPath,
        rawConfig: workflowDefinition.config,
        defaultWorkspaceRoot: path.join(projectOption.value.workspaceRoot, ".t3code", "workspaces"),
      });
      if (workflow instanceof Error) {
        return yield* workflow;
      }

      const preparedWorkspace = yield* workspaceManager.prepareWorkspace({
        workspaceRoot: workflow.workspace.root,
        taskIdentifier: task.identifier,
        hooks: workflow.hooks,
      });

      const startAt = yield* nowIso;
      const logLines = [
        `[${startAt}] Starting task run ${input.runId} for ${task.identifier}`,
        `[${startAt}] Workspace: ${preparedWorkspace.workspacePath}`,
      ];

      yield* updateTaskAndRun({
        taskId: task.id,
        runId: input.runId,
        mutateTask: (currentTask) => ({
          ...currentTask,
          workspacePath: preparedWorkspace.workspacePath,
          runStatus: "starting",
          activeRunId: input.runId,
          latestActivity: "Preparing isolated task workspace.",
          lastError: null,
          updatedAt: startAt,
        }),
        mutateRun: (currentRun) => ({
          ...currentRun,
          status: "starting",
          workspacePath: preparedWorkspace.workspacePath,
          latestActivity: "Preparing isolated task workspace.",
          lastError: null,
          startedAt: startAt,
          updatedAt: startAt,
        }),
      });

      yield* workspaceManager.runBeforeRunHooks({
        workspacePath: preparedWorkspace.workspacePath,
        hooks: workflow.hooks,
      });

      const settings = yield* serverSettings.getSettings;
      const codexExecution = resolveCodexExecutionSettings({
        settings,
        instanceId: input.instanceId,
      });
      const homeLayout = yield* resolveCodexHomeLayout(codexExecution.codexSettings);
      yield* materializeCodexShadowHome(homeLayout);

      const prompt = renderWorkflowPrompt({
        workflowPath,
        promptTemplate: workflowDefinition.promptTemplate,
        task: toWorkflowTaskLike(task),
        attempt: run.attempt,
      });
      if (prompt instanceof Error) {
        return yield* prompt;
      }

      const runtimeScope = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(runtimeScope, Exit.void));
      const runtimeOptions = {
        threadId: ThreadId.make(`task-run-${input.runId}`),
        providerInstanceId: codexExecution.instanceId,
        binaryPath: codexExecution.codexSettings.binaryPath,
        cwd: preparedWorkspace.workspacePath,
        runtimeMode: "full-access" as const,
        ...(homeLayout.effectiveHomePath ? { homePath: homeLayout.effectiveHomePath } : {}),
        ...(codexExecution.environment ? { environment: codexExecution.environment } : {}),
        ...(codexExecution.model ? { model: codexExecution.model } : {}),
      } satisfies CodexSessionRuntimeOptions;
      const runtimeEffect = runtimeFactory.make(runtimeOptions);
      const runtime = yield* runtimeEffect.pipe(Effect.provideService(Scope.Scope, runtimeScope));

      const completionDeferred = yield* Deferred.make<{
        readonly success: boolean;
        readonly errorMessage: string | null;
      }>();

      const eventFiber = yield* Effect.forkScoped(
        runtime.events.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.kind === "notification" && event.method === "turn/started") {
                const startedAt = yield* nowIso;
                logLines.push(`[${startedAt}] Codex turn started.`);
                yield* updateTaskAndRun({
                  taskId: task.id,
                  runId: input.runId,
                  mutateTask: (currentTask) => ({
                    ...currentTask,
                    runStatus: run.status === "retrying" ? "retrying" : "running",
                    latestActivity: "Codex is working in the task workspace.",
                    updatedAt: startedAt,
                  }),
                  mutateRun: (currentRun) => ({
                    ...currentRun,
                    status: run.status === "retrying" ? "retrying" : "running",
                    latestActivity: "Codex is working in the task workspace.",
                    startedAt: currentRun.startedAt ?? startedAt,
                    updatedAt: startedAt,
                  }),
                });
                return;
              }

              if (event.kind === "notification" && event.method === "thread/tokenUsage/updated") {
                const tokenUsage = maybeTokenUsageFromEvent(event);
                if (!tokenUsage) return;
                yield* updateTaskAndRun({
                  taskId: task.id,
                  runId: input.runId,
                  mutateTask: (currentTask) => ({
                    ...currentTask,
                    updatedAt: event.createdAt,
                  }),
                  mutateRun: (currentRun) => ({
                    ...currentRun,
                    tokenUsage,
                    updatedAt: event.createdAt,
                  }),
                });
                return;
              }

              if (event.kind === "notification" && event.method === "turn/completed") {
                const payload = isPlainObject(event.payload) ? event.payload : {};
                const turn = isPlainObject(payload.turn) ? payload.turn : {};
                const success = turn.status !== "failed";
                const turnError =
                  isPlainObject(turn.error) && typeof turn.error.message === "string"
                    ? turn.error.message
                    : null;
                logLines.push(
                  `[${event.createdAt}] Codex turn completed with status ${String(turn.status ?? "unknown")}.`,
                );
                yield* Deferred.succeed(completionDeferred, {
                  success,
                  errorMessage: turnError,
                }).pipe(Effect.ignore);
              }
            }),
          ),
        ),
      );

      yield* runtime.start();
      yield* runtime.sendTurn({
        input: prompt,
        interactionMode: "default",
      });

      const completionOption = yield* Deferred.await(completionDeferred).pipe(
        Effect.timeoutOption(workflow.codex.turnTimeoutMs),
        Effect.ensuring(Fiber.interrupt(eventFiber)),
      );
      if (Option.isNone(completionOption)) {
        return yield* new ProjectTaskBoardError({
          message: `Task run ${input.runId} timed out after ${workflow.codex.turnTimeoutMs}ms.`,
        });
      }

      const completion = completionOption.value;
      const verification = completion.success
        ? yield* runVerification({
            workspacePath: preparedWorkspace.workspacePath,
            workflow,
          })
        : null;
      const verificationFailed = verification?.status === "failed";
      const finishAt = yield* nowIso;
      const runtimeMs = Math.max(0, Date.parse(finishAt) - Date.parse(startAt));
      const success = completion.success && !verificationFailed;
      const finalStatus = success ? "succeeded" : "failed";
      const finalMessage = success
        ? "Task run completed successfully."
        : verificationFailed
          ? "Task run completed, but verification failed."
          : (completion.errorMessage ?? "Task run failed.");

      logLines.push(`[${finishAt}] ${finalMessage}`);
      const artifactPayload = yield* writeRunArtifacts({
        run: { ...run, workspacePath: preparedWorkspace.workspacePath },
        verification,
        logLines,
      });

      yield* updateTaskAndRun({
        taskId: task.id,
        runId: input.runId,
        mutateTask: (currentTask) => ({
          ...currentTask,
          workspacePath: preparedWorkspace.workspacePath,
          runStatus: finalStatus,
          activeRunId: null,
          column: success ? "Review" : currentTask.column,
          columnKey: success ? "review" : currentTask.columnKey,
          latestActivity: finalMessage,
          lastError: success ? null : finalMessage,
          updatedAt: finishAt,
        }),
        mutateRun: (currentRun) => ({
          ...currentRun,
          status: finalStatus,
          workspacePath: preparedWorkspace.workspacePath,
          latestActivity: finalMessage,
          lastError: success ? null : finalMessage,
          finishedAt: finishAt,
          updatedAt: finishAt,
          runtimeMs,
          artifacts: [...currentRun.artifacts, ...artifactPayload.artifacts],
          verification: artifactPayload.verification,
        }),
      });

      yield* workspaceManager.runAfterRunHooks({
        workspacePath: preparedWorkspace.workspacePath,
        hooks: workflow.hooks,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const finishAt = yield* nowIso;
          const runOption = yield* runs
            .getById({ runId: input.runId })
            .pipe(Effect.mapError(toProjectTaskBoardError("Failed to read failed task run.")));
          if (Option.isSome(runOption)) {
            const taskOption = yield* tasks
              .getById({ taskId: runOption.value.taskId })
              .pipe(Effect.mapError(toProjectTaskBoardError("Failed to read failed task.")));
            if (Option.isSome(taskOption)) {
              const runtimeMs =
                runOption.value.startedAt === null
                  ? null
                  : Math.max(0, Date.parse(finishAt) - Date.parse(runOption.value.startedAt));
              const message = errorMessage(error);
              yield* tasks
                .upsert({
                  ...taskOption.value,
                  runStatus: "failed",
                  activeRunId: null,
                  latestActivity: message,
                  lastError: message,
                  updatedAt: finishAt,
                })
                .pipe(Effect.mapError(toProjectTaskBoardError("Failed to persist task failure.")));
              yield* runs
                .upsert({
                  ...runOption.value,
                  status: "failed",
                  latestActivity: message,
                  lastError: message,
                  finishedAt: finishAt,
                  updatedAt: finishAt,
                  runtimeMs,
                })
                .pipe(
                  Effect.mapError(toProjectTaskBoardError("Failed to persist task-run failure.")),
                );
            }
          }
          yield* Effect.logError("Background task run failed", {
            runId: input.runId,
            error,
          });
        }),
      ),
    );
  });

  const enqueueRun: TaskRunExecutorShape["enqueueRun"] = Effect.fn("TaskRunExecutor.enqueueRun")(
    function* (input) {
      const fiber = yield* executeRun(input).pipe(
        Effect.ensuring(
          Ref.update(runningFibersRef, (current) => {
            const next = new Map(current);
            next.delete(input.runId);
            return next;
          }),
        ),
        Effect.forkIn(backgroundScope),
      ) as Effect.Effect<Fiber.Fiber<void, ProjectTaskBoardError>, never>;
      yield* Ref.update(runningFibersRef, (current) => {
        const next = new Map(current);
        next.set(input.runId, fiber);
        return next;
      });
    },
  );

  const cancelRun: TaskRunExecutorShape["cancelRun"] = Effect.fn("TaskRunExecutor.cancelRun")(
    function* (runId) {
      const fiber = yield* Ref.modify(runningFibersRef, (current) => {
        const next = new Map(current);
        const active = next.get(runId);
        next.delete(runId);
        return [active ?? null, next] as const;
      });
      if (fiber) {
        yield* Fiber.interrupt(fiber);
      }
    },
  );

  return TaskRunExecutor.of({
    enqueueRun,
    cancelRun,
  });
});

const makeTaskRunCodexRuntimeFactory = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return TaskRunCodexRuntimeFactory.of({
    make: (options) =>
      makeCodexSessionRuntime(options).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
  });
});

export const TaskRunCodexRuntimeFactoryLive = Layer.effect(
  TaskRunCodexRuntimeFactory,
  makeTaskRunCodexRuntimeFactory,
);

export const TaskRunExecutorLayer = Layer.effect(TaskRunExecutor, makeTaskRunExecutor);

export const TaskRunExecutorLive = TaskRunExecutorLayer.pipe(
  Layer.provideMerge(TaskRunCodexRuntimeFactoryLive),
);
