import "../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationReadModel,
  type ProjectTaskAssistantResponse,
  type ProjectTask,
  type ProjectId,
  type ProjectTaskRun,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerConfig,
  type ServerLifecycleWelcomePayload,
  ServerConfig as ServerConfigSchema,
  TaskId,
  TaskRunId,
  ThreadId,
  TurnId,
  WS_METHODS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { http, HttpResponse, ws } from "msw";
import { setupWorker } from "msw/browser";
import * as Schema from "effect/Schema";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { __resetLocalApiForTests } from "../localApi";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { getServerConfig } from "../rpc/serverState";
import { getWsConnectionStatus } from "../rpc/wsConnectionState";
import { getRouter } from "../router";
import { useStore } from "../store";
import { BrowserWsRpcHarness } from "../../test/wsRpcHarness";
import { createAuthenticatedSessionHandlers } from "../../test/authHttpHandlers";

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = "project-board" as ProjectId;
const NOW_ISO = "2026-05-20T12:00:00.000Z";
const TASK_ID = TaskId.make("task-board-1");
const BACKLOG_THREAD_ID = ThreadId.make("thread-backlog");
const TODO_THREAD_ID = ThreadId.make("thread-todo");
const IN_PROGRESS_THREAD_ID = ThreadId.make("thread-in-progress");
const REVIEW_THREAD_ID = ThreadId.make("thread-review");
const DONE_THREAD_ID = ThreadId.make("thread-done");

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: ServerLifecycleWelcomePayload;
  tasks: Array<ProjectTask>;
  runs: Array<ProjectTaskRun>;
}

let fixture: TestFixture;
const rpcHarness = new BrowserWsRpcHarness();
const encodeServerConfig = Schema.encodeSync(ServerConfigSchema);
const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createBaseServerConfig(): ServerConfig {
  return {
    environment: {
      environmentId: LOCAL_ENVIRONMENT_ID,
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        driver: ProviderDriverKind.make("codex"),
        instanceId: ProviderInstanceId.make("codex"),
        enabled: true,
        installed: true,
        version: "0.116.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: NOW_ISO,
        models: [],
        slashCommands: [],
        skills: [],
      },
    ],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultThreadEnvMode: "local" as const,
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4-mini",
      },
      providers: {
        codex: {
          enabled: true,
          binaryPath: "",
          homePath: "",
          shadowHomePath: "",
          customModels: [],
        },
        claudeAgent: {
          enabled: true,
          binaryPath: "",
          homePath: "",
          customModels: [],
          launchArgs: "",
        },
        cursor: { enabled: true, binaryPath: "", apiEndpoint: "", customModels: [] },
        opencode: {
          enabled: true,
          binaryPath: "",
          serverUrl: "",
          serverPassword: "",
          customModels: [],
        },
      },
    },
  };
}

function createMinimalSnapshot(): OrchestrationReadModel {
  const modelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5",
  };
  const createThread = (
    id: ThreadId,
    title: string,
    options: {
      readonly sessionStatus?: "ready" | "running";
      readonly latestTurnState?: "running" | "interrupted" | "completed" | "error";
      readonly hasUserMessage?: boolean;
      readonly interactionMode?: "default" | "plan";
      readonly proposedPlans?: OrchestrationReadModel["threads"][number]["proposedPlans"];
    } = {},
  ): OrchestrationReadModel["threads"][number] => {
    const latestTurn = options.latestTurnState
      ? {
          turnId: TurnId.make(`turn-${id}`),
          state: options.latestTurnState,
          requestedAt: NOW_ISO,
          startedAt: NOW_ISO,
          completedAt: options.latestTurnState === "running" ? null : NOW_ISO,
          assistantMessageId: MessageId.make(`msg-assistant-${id}`),
        }
      : null;
    return {
      id,
      projectId: PROJECT_ID,
      title,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: options.interactionMode ?? "default",
      branch: "main",
      worktreePath: null,
      latestTurn,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      archivedAt: null,
      deletedAt: null,
      messages: options.hasUserMessage
        ? [
            {
              id: MessageId.make(`msg-user-${id}`),
              role: "user",
              text: `Work on ${title}`,
              turnId: latestTurn?.turnId ?? null,
              streaming: false,
              createdAt: NOW_ISO,
              updatedAt: NOW_ISO,
            },
          ]
        : [],
      proposedPlans: options.proposedPlans ?? [],
      activities: [],
      checkpoints: [],
      session: {
        threadId: id,
        status: options.sessionStatus ?? "ready",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: options.latestTurnState === "running" ? (latestTurn?.turnId ?? null) : null,
        lastError: null,
        updatedAt: NOW_ISO,
      },
    };
  };

  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project Board",
        workspaceRoot: "/repo/project",
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      createThread(BACKLOG_THREAD_ID, "Backlog thread"),
      createThread(TODO_THREAD_ID, "Todo thread", { hasUserMessage: true }),
      createThread(IN_PROGRESS_THREAD_ID, "Running thread", {
        sessionStatus: "running",
        latestTurnState: "running",
        hasUserMessage: true,
      }),
      createThread(REVIEW_THREAD_ID, "Review thread", {
        latestTurnState: "error",
        hasUserMessage: true,
      }),
      createThread(DONE_THREAD_ID, "Done thread", {
        latestTurnState: "completed",
        hasUserMessage: true,
      }),
    ],
    updatedAt: NOW_ISO,
  };
}

function toShellThread(thread: OrchestrationReadModel["threads"][number]) {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestTurn: thread.latestTurn,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    session: thread.session,
    latestUserMessageAt:
      thread.messages.findLast((message) => message.role === "user")?.createdAt ?? null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function toShellSnapshot(snapshot: OrchestrationReadModel) {
  return {
    snapshotSequence: snapshot.snapshotSequence,
    projects: snapshot.projects.map((project) => ({
      id: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      repositoryIdentity: project.repositoryIdentity ?? null,
      defaultModelSelection: project.defaultModelSelection,
      scripts: project.scripts,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })),
    threads: snapshot.threads.map(toShellThread),
    updatedAt: snapshot.updatedAt,
  };
}

function buildFixture(): TestFixture {
  const task: ProjectTask = {
    id: TASK_ID,
    projectId: PROJECT_ID,
    identifier: "ABC-123",
    title: "Ship board view",
    description: "Implement the task board surface.",
    column: "Todo",
    columnKey: "todo",
    priority: "high",
    labels: ["board"],
    blockedBy: [],
    sortOrder: 0,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    runStatus: "queued",
    activeRunId: TaskRunId.make("run-1"),
    workspacePath: "/srv/t3code/workspaces/ABC-123",
    latestActivity: "Queued",
    lastError: null,
  };
  return {
    snapshot: createMinimalSnapshot(),
    serverConfig: createBaseServerConfig(),
    welcome: {
      environment: {
        environmentId: LOCAL_ENVIRONMENT_ID,
        label: "Local environment",
        platform: { os: "darwin" as const, arch: "arm64" as const },
        serverVersion: "0.0.0-test",
        capabilities: { repositoryIdentity: true },
      },
      cwd: "/repo/project",
      projectName: "Project Board",
      bootstrapProjectId: PROJECT_ID,
    },
    tasks: [task],
    runs: [
      {
        id: TaskRunId.make("run-1"),
        taskId: TASK_ID,
        projectId: PROJECT_ID,
        status: "failed",
        attempt: 1,
        workspacePath: "/srv/t3code/workspaces/ABC-123",
        latestActivity: "Verification failed after background execution.",
        lastError: "pnpm lint failed",
        startedAt: NOW_ISO,
        updatedAt: NOW_ISO,
        finishedAt: NOW_ISO,
        runtimeMs: 12_500,
        tokenUsage: {
          inputTokens: 1200,
          outputTokens: 340,
          totalTokens: 1540,
        },
        artifacts: [
          {
            id: "artifact-runner-log",
            kind: "log",
            label: "Runner log",
            path: "/srv/t3code/workspaces/ABC-123/.t3code/task-runs/run-1/runner.log",
            createdAt: NOW_ISO,
          },
          {
            id: "artifact-verification",
            kind: "report",
            label: "Verification report",
            path: "/srv/t3code/workspaces/ABC-123/.t3code/task-runs/run-1/verification.json",
            createdAt: NOW_ISO,
          },
        ],
        verification: {
          status: "failed",
          commands: [
            {
              command: "pnpm lint",
              status: "failed",
              detail: "src/routes/task.tsx:12:3 lint error",
            },
          ],
          screenshots: [],
        },
      },
    ],
  };
}

function getTaskOrThrow(taskId: TaskId): ProjectTask {
  const task = fixture.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Unknown fixture task: ${taskId}`);
  }
  return task;
}

function setTask(nextTask: ProjectTask) {
  fixture.tasks = fixture.tasks.map((task) => (task.id === nextTask.id ? nextTask : task));
}

function boardColumnsFromFixture() {
  return [
    {
      key: "backlog",
      label: "Backlog",
      tasks: fixture.tasks.filter((task) => task.columnKey === "backlog"),
    },
    {
      key: "todo",
      label: "Todo",
      tasks: fixture.tasks.filter((task) => task.columnKey === "todo"),
    },
    {
      key: "in_progress",
      label: "In Progress",
      tasks: fixture.tasks.filter((task) => task.columnKey === "in_progress"),
    },
    {
      key: "review",
      label: "Review",
      tasks: fixture.tasks.filter((task) => task.columnKey === "review"),
    },
    {
      key: "done",
      label: "Done",
      tasks: fixture.tasks.filter((task) => task.columnKey === "done"),
    },
  ] as const;
}

function resolveWsRpc(tag: string): unknown {
  if (tag === WS_METHODS.serverGetConfig) {
    return encodeServerConfig(fixture.serverConfig);
  }
  if (tag === WS_METHODS.projectTasksGetBoard) {
    return {
      projectId: PROJECT_ID,
      columns: boardColumnsFromFixture(),
      activeRunCount: fixture.tasks.filter(
        (task) =>
          task.activeRunId !== null ||
          ["queued", "starting", "running", "retrying"].includes(task.runStatus),
      ).length,
      updatedAt: fixture.tasks[0]?.updatedAt ?? NOW_ISO,
    };
  }
  if (tag === WS_METHODS.projectTasksGetTask) {
    return getTaskOrThrow(TASK_ID);
  }
  if (tag === WS_METHODS.projectTasksListRuns) {
    return fixture.runs;
  }
  if (tag === WS_METHODS.projectTasksStartRun) {
    const task = getTaskOrThrow(TASK_ID);
    setTask({
      ...task,
      runStatus: "queued",
      activeRunId: TaskRunId.make("run-2"),
      latestActivity: "Queued for background execution.",
      updatedAt: NOW_ISO,
    });
    const run: ProjectTaskRun = {
      id: TaskRunId.make("run-2"),
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      status: "queued",
      attempt: 2,
      workspacePath: "/srv/t3code/workspaces/ABC-123",
      latestActivity: "Queued for background execution.",
      lastError: null,
      startedAt: null,
      updatedAt: NOW_ISO,
      finishedAt: null,
      runtimeMs: null,
      tokenUsage: null,
      artifacts: [],
      verification: null,
    };
    fixture.runs = [run, ...fixture.runs];
    return run;
  }
  if (tag === WS_METHODS.projectTasksStopRun) {
    const task = getTaskOrThrow(TASK_ID);
    const activeRunId = task.activeRunId ?? TaskRunId.make("run-2");
    setTask({
      ...task,
      runStatus: "canceled",
      activeRunId: null,
      latestActivity: "Canceled by operator.",
      updatedAt: NOW_ISO,
    });
    fixture.runs = fixture.runs.map((run) =>
      run.id === activeRunId
        ? {
            ...run,
            status: "canceled",
            latestActivity: "Canceled by operator.",
            finishedAt: NOW_ISO,
            updatedAt: NOW_ISO,
          }
        : run,
    );
    return fixture.runs.find((run) => run.id === activeRunId) ?? fixture.runs[0] ?? {};
  }
  if (tag === WS_METHODS.projectTasksRetryRun) {
    const task = getTaskOrThrow(TASK_ID);
    setTask({
      ...task,
      runStatus: "retrying",
      activeRunId: TaskRunId.make("run-3"),
      latestActivity: "Queued for retry.",
      updatedAt: NOW_ISO,
    });
    const run: ProjectTaskRun = {
      id: TaskRunId.make("run-3"),
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      status: "retrying",
      attempt: 3,
      workspacePath: "/srv/t3code/workspaces/ABC-123",
      latestActivity: "Queued for retry.",
      lastError: null,
      startedAt: null,
      updatedAt: NOW_ISO,
      finishedAt: null,
      runtimeMs: null,
      tokenUsage: null,
      artifacts: [],
      verification: null,
    };
    fixture.runs = [run, ...fixture.runs];
    return run;
  }
  if (tag === WS_METHODS.projectTasksAssistantRespond) {
    const request = rpcHarness.requests.at(-1);
    const message =
      request &&
      request._tag === WS_METHODS.projectTasksAssistantRespond &&
      typeof request.message === "string"
        ? request.message
        : "";
    const createMatch =
      /^create task\s+([a-z0-9._-]+)\s*:\s*(.+?)(?:\s+in\s+(backlog|todo|in progress|review|done))?(?:\s+priority\s+(none|low|medium|high|urgent))?$/i.exec(
        message,
      );
    if (createMatch) {
      const columnLabel = createMatch[3]?.toLowerCase() === "review" ? "Review" : "Todo";
      const columnKey = createMatch[3]?.toLowerCase() === "review" ? "review" : "todo";
      const createdTask: ProjectTask = {
        id: TaskId.make("task-board-2"),
        projectId: PROJECT_ID,
        identifier: createMatch[1]!.toUpperCase(),
        title: createMatch[2]!,
        description: null,
        column: columnLabel,
        columnKey,
        priority: createMatch[4]?.toLowerCase() === "high" ? "high" : "none",
        labels: [],
        blockedBy: [],
        sortOrder: fixture.tasks.filter((task) => task.columnKey === columnKey).length,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        runStatus: "idle",
        activeRunId: null,
        workspacePath: null,
        latestActivity: null,
        lastError: null,
      };
      fixture.tasks = [...fixture.tasks, createdTask];
      return {
        reply: `Created task ${createdTask.identifier} in ${createdTask.column}.`,
        toolCalls: [
          {
            toolName: "create_task",
            summary: `Created task ${createdTask.identifier} in ${createdTask.column}.`,
          },
        ],
      } satisfies ProjectTaskAssistantResponse;
    }
    const moveMatch =
      /^move task\s+([a-z0-9._-]+)\s+to\s+(backlog|todo|in progress|review|done)$/i.exec(message);
    if (moveMatch) {
      const targetTask = fixture.tasks.find(
        (task) => task.identifier === moveMatch[1]!.toUpperCase(),
      );
      if (targetTask) {
        const columnMap = {
          backlog: { column: "Backlog", columnKey: "backlog" },
          todo: { column: "Todo", columnKey: "todo" },
          "in progress": { column: "In Progress", columnKey: "in_progress" },
          review: { column: "Review", columnKey: "review" },
          done: { column: "Done", columnKey: "done" },
        } as const;
        const nextColumn = columnMap[moveMatch[2]!.toLowerCase() as keyof typeof columnMap];
        setTask({
          ...targetTask,
          column: nextColumn.column,
          columnKey: nextColumn.columnKey,
          updatedAt: NOW_ISO,
        });
        return {
          reply: `Moved task ${targetTask.identifier} to ${nextColumn.column}.`,
          toolCalls: [
            {
              toolName: "move_task",
              summary: `Moved task ${targetTask.identifier} to ${nextColumn.column}.`,
            },
          ],
        } satisfies ProjectTaskAssistantResponse;
      }
    }
    return {
      reply: "Restricted board assistant only.",
      toolCalls: [],
    } satisfies ProjectTaskAssistantResponse;
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    void rpcHarness.connect(client);
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      void rpcHarness.onMessage(rawData);
    });
  }),
  ...createAuthenticatedSessionHandlers(() => fixture.serverConfig.auth),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function waitForWsConnection(): Promise<void> {
  await expect
    .poll(() => getWsConnectionStatus().phase, {
      timeout: 8_000,
      interval: 16,
    })
    .toBe("connected");
}

async function waitForInitialWsSubscriptions(): Promise<void> {
  await expect
    .poll(
      () => ({
        serverLifecycle: rpcHarness.requests.some(
          (request) => request._tag === WS_METHODS.subscribeServerLifecycle,
        ),
        serverConfig: rpcHarness.requests.some(
          (request) => request._tag === WS_METHODS.subscribeServerConfig,
        ),
      }),
      {
        timeout: 8_000,
        interval: 16,
      },
    )
    .toEqual({
      serverLifecycle: true,
      serverConfig: true,
    });
}

async function waitForServerConfigSnapshot(): Promise<void> {
  await expect
    .poll(() => getServerConfig(), {
      timeout: 8_000,
      interval: 16,
    })
    .not.toBeNull();
}

async function mountApp(initialPath: string) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(createMemoryHistory({ initialEntries: [initialPath] }));
  const screen = await render(
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
    </AppAtomRegistryProvider>,
    { container: host },
  );
  await waitForInitialWsSubscriptions();
  await waitForWsConnection();
  await waitForServerConfigSnapshot();

  return {
    screen,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("Project board routes", () => {
  beforeAll(async () => {
    fixture = buildFixture();
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  });

  afterAll(async () => {
    await rpcHarness.disconnect();
    await worker.stop();
  });

  beforeEach(async () => {
    fixture = buildFixture();
    await rpcHarness.reset({
      resolveUnary: (request) => resolveWsRpc(request._tag),
      getInitialStreamValues: (request) => {
        if (request._tag === WS_METHODS.subscribeServerLifecycle) {
          return [
            {
              version: 1,
              sequence: 1,
              type: "welcome",
              payload: fixture.welcome,
            },
          ];
        }
        if (request._tag === WS_METHODS.subscribeServerConfig) {
          return [
            {
              version: 1,
              type: "snapshot",
              config: encodeServerConfig(fixture.serverConfig),
            },
          ];
        }
        if (request._tag === ORCHESTRATION_WS_METHODS.subscribeShell) {
          return [
            {
              kind: "snapshot",
              snapshot: toShellSnapshot(fixture.snapshot),
            },
          ];
        }
        if (request._tag === ORCHESTRATION_WS_METHODS.subscribeThread) {
          const thread = fixture.snapshot.threads.find((entry) => entry.id === request.threadId);
          return thread
            ? [
                {
                  kind: "snapshot",
                  snapshot: {
                    snapshotSequence: fixture.snapshot.snapshotSequence,
                    thread,
                  },
                },
              ]
            : [];
        }
        return [];
      },
    });
    await __resetLocalApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
    useStore.setState({
      activeEnvironmentId: null,
      environmentStateById: {},
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders threads in runtime-derived board columns inside the app shell", async () => {
    const mounted = await mountApp(`/${LOCAL_ENVIRONMENT_ID}/board/${PROJECT_ID}`);

    try {
      await expect
        .element(mounted.screen.getByText("Project Board", { exact: true }).first())
        .toBeInTheDocument();
      await expect.element(mounted.screen.getByText("Backlog thread")).toBeInTheDocument();
      await expect.element(mounted.screen.getByText("Todo thread")).toBeInTheDocument();
      await expect.element(mounted.screen.getByText("Running thread")).toBeInTheDocument();
      await expect.element(mounted.screen.getByText("Review thread")).toBeInTheDocument();
      await expect.element(mounted.screen.getByText("Done thread")).toBeInTheDocument();
      await expect.element(mounted.screen.getByText("1 active")).toBeInTheDocument();
      await expect
        .element(mounted.screen.getByText("No threads in backlog."))
        .not.toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("navigates from a board card into the normal thread route", async () => {
    const mounted = await mountApp(`/${LOCAL_ENVIRONMENT_ID}/board/${PROJECT_ID}`);

    try {
      const threadCard = mounted.screen.getByRole("link", { name: /Todo thread/i });
      await expect.element(threadCard).toBeInTheDocument();

      await threadCard.click();

      await expect.element(mounted.screen.getByText("Work on Todo thread")).toBeInTheDocument();
      await expect
        .element(mounted.screen.getByText("Backlog thread", { exact: true }))
        .not.toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not render a board assistant or right sidebar", async () => {
    const mounted = await mountApp(`/${LOCAL_ENVIRONMENT_ID}/board/${PROJECT_ID}`);

    try {
      await expect
        .element(mounted.screen.getByText("Project Board", { exact: true }).first())
        .toBeInTheDocument();
      await expect.element(mounted.screen.getByText("Open assistant")).not.toBeInTheDocument();
      await expect
        .element(mounted.screen.getByText("Restricted task tools"))
        .not.toBeInTheDocument();
      await expect.element(mounted.screen.getByText("Board Assistant")).not.toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs task detail start and stop controls through task RPCs", async () => {
    setTask({
      ...getTaskOrThrow(TASK_ID),
      runStatus: "idle",
      activeRunId: null,
      latestActivity: null,
    });
    fixture.runs = [];

    const mounted = await mountApp(`/${LOCAL_ENVIRONMENT_ID}/board/${PROJECT_ID}/task/${TASK_ID}`);

    try {
      await expect
        .element(mounted.screen.getByText("Task Work View", { exact: true }))
        .toBeInTheDocument();
      const startRunButton = mounted.screen.getByRole("button", { name: "Start run" });
      await startRunButton.click();

      await expect
        .element(mounted.screen.getByRole("button", { name: "Stop run" }))
        .toBeInTheDocument();

      const stopRunButton = mounted.screen.getByRole("button", { name: "Stop run" });
      await stopRunButton.click();

      await expect
        .element(mounted.screen.getByRole("button", { name: "Retry run" }))
        .toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders run verification, token usage, and artifacts on task detail", async () => {
    setTask({
      ...getTaskOrThrow(TASK_ID),
      runStatus: "failed",
      activeRunId: null,
      latestActivity: "Verification failed after background execution.",
      lastError: "pnpm lint failed",
    });

    const mounted = await mountApp(`/${LOCAL_ENVIRONMENT_ID}/board/${PROJECT_ID}/task/${TASK_ID}`);

    try {
      await expect
        .element(mounted.screen.getByRole("heading", { name: "Verification" }))
        .toBeInTheDocument();
      await expect.element(mounted.screen.getByText(/1,540 total/)).toBeInTheDocument();
      await expect
        .element(mounted.screen.getByText("pnpm lint", { exact: true }))
        .toBeInTheDocument();
      await expect.element(mounted.screen.getByText(/runner\.log$/)).toBeInTheDocument();
      await expect.element(mounted.screen.getByText(/verification\.json$/)).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });
});
