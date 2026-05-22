import { EnvironmentId, ProjectId, TaskId } from "@t3tools/contracts";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  projectTaskBoardQueryOptions,
  projectTaskQueryOptions,
  projectTaskRunsQueryOptions,
  retryProjectTaskRunMutationOptions,
  startProjectTaskRunMutationOptions,
  stopProjectTaskRunMutationOptions,
} from "../lib/taskBoardReactQuery";
import { selectProjectsForEnvironment, useStore } from "../store";
import { Button } from "../components/ui/button";

const ACTIVE_RUN_STATUSES = new Set(["queued", "starting", "running", "retrying"]);

function formatRuntime(runtimeMs: number | null): string {
  if (runtimeMs === null) return "runtime n/a";
  if (runtimeMs < 1_000) return `${runtimeMs}ms`;
  return `${Math.round(runtimeMs / 100) / 10}s`;
}

function formatTokenUsageSummary(
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
): string {
  return `${totalTokens.toLocaleString()} total (${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out)`;
}

function ProjectTaskDetailRouteView() {
  const params = Route.useParams();
  const environmentId = EnvironmentId.make(params.environmentId);
  const projectId = ProjectId.make(params.projectId);
  const taskId = TaskId.make(params.taskId);
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const projects = useStore(
    useShallow((state) => selectProjectsForEnvironment(state, environmentId)),
  );
  const activeProject = projects.find((project) => project.id === projectId) ?? null;
  const boardQuery = useQuery(
    projectTaskBoardQueryOptions({
      environmentId,
      projectId,
      enabled: activeProject !== null,
    }),
  );
  const taskQuery = useQuery(
    projectTaskQueryOptions({
      environmentId,
      taskId,
      enabled: activeProject !== null,
    }),
  );
  const runsQuery = useQuery(
    projectTaskRunsQueryOptions({
      environmentId,
      projectId,
      enabled: activeProject !== null,
    }),
  );

  const task = taskQuery.data ?? null;
  const taskRuns = (runsQuery.data ?? []).filter((run) => run.taskId === taskId);
  const startRunMutation = useMutation(
    startProjectTaskRunMutationOptions({
      environmentId,
      projectId,
      queryClient,
    }),
  );
  const stopRunMutation = useMutation(
    stopProjectTaskRunMutationOptions({
      environmentId,
      projectId,
      queryClient,
    }),
  );
  const retryRunMutation = useMutation(
    retryProjectTaskRunMutationOptions({
      environmentId,
      projectId,
      queryClient,
    }),
  );
  const hasActiveRun = task ? ACTIVE_RUN_STATUSES.has(task.runStatus) : false;
  const canRetry = task ? task.runStatus === "failed" || task.runStatus === "canceled" : false;
  const isMutating =
    startRunMutation.isPending || stopRunMutation.isPending || retryRunMutation.isPending;

  const runAction = async (action: "start" | "stop" | "retry") => {
    if (!task) return;
    setMutationError(null);
    try {
      if (action === "start") {
        await startRunMutation.mutateAsync({ taskId: task.id });
        return;
      }
      if (action === "stop") {
        await stopRunMutation.mutateAsync({ taskId: task.id });
        return;
      }
      await retryRunMutation.mutateAsync({ taskId: task.id });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Task action failed.");
    }
  };

  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1650px] flex-col px-4 py-4 sm:px-6">
        <header className="rounded-xl border bg-card px-4 py-4 shadow-sm sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            {projects.map((project) => {
              const isActive = project.id === projectId;
              return (
                <Link
                  key={project.id}
                  to="/$environmentId/board/$projectId"
                  params={{
                    environmentId,
                    projectId: project.id,
                  }}
                  className={[
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  ].join(" ")}
                >
                  {project.name}
                </Link>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Task Work View
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {task?.title ?? "Loading task"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeProject?.name ?? "Unknown project"}
              </p>
            </div>
            <Link
              to="/$environmentId/board/$projectId"
              params={{ environmentId, projectId }}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Back to board
            </Link>
          </div>
        </header>

        <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto rounded-xl border bg-card p-3 shadow-sm">
            <div className="mb-3 border-b px-1 pb-3">
              <h2 className="text-sm font-semibold tracking-wide">Project Tasks</h2>
              <p className="text-xs text-muted-foreground">Grouped by kanban column</p>
            </div>
            <div className="space-y-4">
              {(boardQuery.data?.columns ?? []).map((column) => (
                <section key={column.key}>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <h3 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                      {column.label}
                    </h3>
                    <span className="text-[11px] text-muted-foreground">{column.tasks.length}</span>
                  </div>
                  <div className="space-y-2">
                    {column.tasks.map((entry) => {
                      const isActive = entry.id === taskId;
                      return (
                        <Link
                          key={entry.id}
                          to="/$environmentId/board/$projectId/task/$taskId"
                          params={{
                            environmentId,
                            projectId,
                            taskId: entry.id,
                          }}
                          className={[
                            "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                            isActive
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background hover:bg-accent/60",
                          ].join(" ")}
                        >
                          <p
                            className={[
                              "text-[11px] font-medium tracking-[0.14em] uppercase",
                              isActive ? "text-primary-foreground/75" : "text-muted-foreground",
                            ].join(" ")}
                          >
                            {entry.identifier}
                          </p>
                          <p className="mt-1 text-sm font-medium leading-tight">{entry.title}</p>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            {taskQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading task details…</p>
            ) : taskQuery.isError ? (
              <p className="text-sm text-red-500">
                {taskQuery.error instanceof Error
                  ? taskQuery.error.message
                  : "Failed to load task details."}
              </p>
            ) : task ? (
              <div className="space-y-6">
                <section className="rounded-xl border bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                        {task.identifier}
                      </p>
                      <h2 className="mt-1 text-xl font-semibold tracking-tight">{task.title}</h2>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="rounded-md border px-3 py-1 text-xs text-muted-foreground">
                        {task.runStatus}
                      </span>
                      {hasActiveRun ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={isMutating}
                          onClick={() => void runAction("stop")}
                        >
                          Stop run
                        </Button>
                      ) : canRetry ? (
                        <Button
                          size="xs"
                          disabled={isMutating}
                          onClick={() => void runAction("retry")}
                        >
                          Retry run
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          disabled={isMutating}
                          onClick={() => void runAction("start")}
                        >
                          Start run
                        </Button>
                      )}
                    </div>
                  </div>
                  {task.description ? (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                      {task.description}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">No task description yet.</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {task.labels.map((label) => (
                      <span
                        key={label}
                        className="rounded-md bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  {mutationError ? (
                    <p className="mt-4 text-sm text-red-500">{mutationError}</p>
                  ) : null}
                </section>

                <section className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-xl border bg-background p-4">
                    <h3 className="text-sm font-semibold">Task Status</h3>
                    <dl className="mt-3 space-y-3 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-muted-foreground">Column</dt>
                        <dd>{task.column}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-muted-foreground">Priority</dt>
                        <dd>{task.priority}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-muted-foreground">Workspace</dt>
                        <dd className="max-w-[24rem] break-all text-right">
                          {task.workspacePath ?? "Not assigned yet"}
                        </dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-muted-foreground">Latest activity</dt>
                        <dd className="max-w-[24rem] text-right">
                          {task.latestActivity ?? "No recent activity"}
                        </dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-muted-foreground">Last error</dt>
                        <dd className="max-w-[24rem] text-right text-red-500">
                          {task.lastError ?? "None"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="rounded-xl border bg-background p-4">
                    <h3 className="text-sm font-semibold">Runs</h3>
                    <div className="mt-3 space-y-3">
                      {runsQuery.isLoading ? (
                        <p className="text-sm text-muted-foreground">Loading run history…</p>
                      ) : taskRuns.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
                      ) : (
                        taskRuns.map((run) => (
                          <article key={run.id} className="rounded-lg border bg-muted/30 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-medium text-muted-foreground">
                                  Attempt {run.attempt}
                                </p>
                                <p className="mt-1 text-sm font-medium">{run.status}</p>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {formatRuntime(run.runtimeMs)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {run.latestActivity ?? run.lastError ?? "No run details yet."}
                            </p>
                            <dl className="mt-3 space-y-2 text-xs text-muted-foreground">
                              <div className="flex items-start justify-between gap-4">
                                <dt>Workspace</dt>
                                <dd className="max-w-[24rem] break-all text-right text-foreground/85">
                                  {run.workspacePath ?? "Not assigned"}
                                </dd>
                              </div>
                              <div className="flex items-start justify-between gap-4">
                                <dt>Started</dt>
                                <dd className="text-right text-foreground/85">
                                  {run.startedAt ?? "Not started"}
                                </dd>
                              </div>
                              <div className="flex items-start justify-between gap-4">
                                <dt>Finished</dt>
                                <dd className="text-right text-foreground/85">
                                  {run.finishedAt ?? "In progress"}
                                </dd>
                              </div>
                              <div className="flex items-start justify-between gap-4">
                                <dt>Tokens</dt>
                                <dd className="max-w-[24rem] text-right text-foreground/85">
                                  {run.tokenUsage
                                    ? formatTokenUsageSummary(
                                        run.tokenUsage.inputTokens,
                                        run.tokenUsage.outputTokens,
                                        run.tokenUsage.totalTokens,
                                      )
                                    : "No token data"}
                                </dd>
                              </div>
                            </dl>
                            {run.verification ? (
                              <div className="mt-3 rounded-lg border bg-background p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <h4 className="text-xs font-semibold tracking-[0.14em] uppercase">
                                    Verification
                                  </h4>
                                  <span className="text-xs text-muted-foreground">
                                    {run.verification.status}
                                  </span>
                                </div>
                                {run.verification.commands.length > 0 ? (
                                  <div className="mt-3 space-y-2">
                                    {run.verification.commands.map((command) => (
                                      <div
                                        key={`${run.id}:${command.command}`}
                                        className="rounded-md border bg-muted/35 px-3 py-2"
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <code className="text-[11px] leading-relaxed break-all">
                                            {command.command}
                                          </code>
                                          <span className="text-[11px] text-muted-foreground">
                                            {command.status}
                                          </span>
                                        </div>
                                        {command.detail ? (
                                          <p className="mt-1 text-[11px] text-muted-foreground">
                                            {command.detail}
                                          </p>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    No verification commands recorded.
                                  </p>
                                )}
                              </div>
                            ) : null}
                            {run.artifacts.length > 0 ? (
                              <div className="mt-3 rounded-lg border bg-background p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <h4 className="text-xs font-semibold tracking-[0.14em] uppercase">
                                    Artifacts
                                  </h4>
                                  <span className="text-xs text-muted-foreground">
                                    {run.artifacts.length}
                                  </span>
                                </div>
                                <div className="mt-3 space-y-2">
                                  {run.artifacts.map((artifact) => (
                                    <div
                                      key={artifact.id}
                                      className="rounded-md border bg-muted/35 px-3 py-2"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <p className="text-xs font-medium">{artifact.label}</p>
                                        <span className="text-[11px] text-muted-foreground">
                                          {artifact.kind}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-[11px] text-muted-foreground">
                                        {artifact.path ?? "No artifact path"}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Task not found.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/board/$projectId/task/$taskId")({
  component: ProjectTaskDetailRouteView,
});
