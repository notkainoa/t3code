import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { respondToAuthError } from "../auth/http.ts";
import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectTaskRunRepository } from "../persistence/Services/ProjectTaskRuns.ts";
import { ProjectTaskRepository } from "../persistence/Services/ProjectTasks.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const requireAuthenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
});

export const taskRunnerStateRouteLayer = HttpRouter.add(
  "GET",
  "/api/v1/state",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const taskRepository = yield* ProjectTaskRepository;
    const taskRunRepository = yield* ProjectTaskRunRepository;
    const providerRegistry = yield* ProviderRegistry;
    const snapshot = yield* projectionSnapshotQuery.getSnapshot();
    const providers = yield* providerRegistry.getProviders;

    const projects = yield* Effect.forEach(snapshot.projects, (project) =>
      Effect.gen(function* () {
        const tasks = yield* taskRepository.listByProject({ projectId: project.id });
        const runs = yield* taskRunRepository.listByProject({ projectId: project.id });
        return {
          id: project.id,
          title: project.title,
          workspaceRoot: project.workspaceRoot,
          taskCount: tasks.length,
          activeRunCount: tasks.filter((task) => task.activeRunId !== null).length,
          latestTaskUpdateAt:
            tasks.reduce<string | null>(
              (latest, task) =>
                latest === null || task.updatedAt > latest ? task.updatedAt : latest,
              null,
            ) ?? null,
          runCount: runs.length,
        };
      }),
    );

    return HttpServerResponse.jsonUnsafe(
      {
        generatedAt: yield* nowIso,
        projects,
        providers: providers.map((provider) => ({
          instanceId: provider.instanceId,
          driver: provider.driver,
          status: provider.status,
          taskExecution: provider.taskExecution ?? null,
        })),
      },
      { status: 200 },
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const taskRunnerTaskDetailRouteLayer = HttpRouter.add(
  "GET",
  "/api/v1/tasks/*",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }
    const identifier = decodeURIComponent(url.value.pathname.slice("/api/v1/tasks/".length)).trim();
    if (identifier.length === 0) {
      return HttpServerResponse.text("Missing task identifier", { status: 400 });
    }

    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const taskRepository = yield* ProjectTaskRepository;
    const taskRunRepository = yield* ProjectTaskRunRepository;
    const snapshot = yield* projectionSnapshotQuery.getSnapshot();

    for (const project of snapshot.projects) {
      const projectTasks = yield* taskRepository.listByProject({ projectId: project.id });
      const task = projectTasks.find(
        (candidate) => candidate.identifier.trim().toUpperCase() === identifier.toUpperCase(),
      );
      if (!task) {
        continue;
      }
      const runs = yield* taskRunRepository.listByTask({ taskId: task.id });
      return HttpServerResponse.jsonUnsafe(
        {
          generatedAt: yield* nowIso,
          project: {
            id: project.id,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
          },
          task,
          runs,
        },
        { status: 200 },
      );
    }

    return HttpServerResponse.jsonUnsafe(
      {
        error: `Unknown task identifier: ${identifier}`,
      },
      { status: 404 },
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const taskRunnerRefreshRouteLayer = HttpRouter.add(
  "POST",
  "/api/v1/refresh",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const providerRegistry = yield* ProviderRegistry;
    const updatedProviders = yield* providerRegistry.refresh();
    return HttpServerResponse.jsonUnsafe(
      {
        refreshedAt: yield* nowIso,
        providerCount: updatedProviders.length,
      },
      { status: 200 },
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);
