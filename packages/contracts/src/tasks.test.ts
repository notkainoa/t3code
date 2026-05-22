import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  CreateProjectTaskInput,
  ProjectTaskAssistantRequest,
  ProjectTaskAssistantResponse,
  ProjectTask,
  ProjectTaskBoardSnapshot,
  ProjectTaskRun,
  ProjectTaskVerificationSummary,
  ReorderProjectTasksInput,
  RetryProjectTaskRunInput,
  StartProjectTaskRunInput,
  StopProjectTaskRunInput,
  UpdateProjectTaskInput,
} from "./tasks.ts";

const decodeCreateProjectTaskInput = Schema.decodeUnknownSync(CreateProjectTaskInput);
const decodeProjectTask = Schema.decodeUnknownSync(ProjectTask);
const decodeProjectTaskRun = Schema.decodeUnknownSync(ProjectTaskRun);
const decodeProjectTaskBoardSnapshot = Schema.decodeUnknownSync(ProjectTaskBoardSnapshot);
const decodeProjectTaskVerificationSummary = Schema.decodeUnknownSync(
  ProjectTaskVerificationSummary,
);
const decodeUpdateProjectTaskInput = Schema.decodeUnknownSync(UpdateProjectTaskInput);
const decodeReorderProjectTasksInput = Schema.decodeUnknownSync(ReorderProjectTasksInput);
const decodeStartProjectTaskRunInput = Schema.decodeUnknownSync(StartProjectTaskRunInput);
const decodeStopProjectTaskRunInput = Schema.decodeUnknownSync(StopProjectTaskRunInput);
const decodeRetryProjectTaskRunInput = Schema.decodeUnknownSync(RetryProjectTaskRunInput);
const decodeProjectTaskAssistantRequest = Schema.decodeUnknownSync(ProjectTaskAssistantRequest);
const decodeProjectTaskAssistantResponse = Schema.decodeUnknownSync(ProjectTaskAssistantResponse);

describe("CreateProjectTaskInput", () => {
  it("applies task creation defaults", () => {
    const parsed = decodeCreateProjectTaskInput({
      projectId: "project-1",
      identifier: "ABC-123",
      title: "Ship kanban view",
    });

    expect(parsed.column).toBe("Todo");
    expect(parsed.columnKey).toBe("todo");
    expect(parsed.priority).toBe("none");
    expect(parsed.labels).toEqual([]);
    expect(parsed.blockedBy).toEqual([]);
    expect(parsed.description).toBeNull();
  });
});

describe("ProjectTask", () => {
  it("decodes the MVP task shape with default arrays", () => {
    const parsed = decodeProjectTask({
      id: "task-1",
      projectId: "project-1",
      identifier: "ABC-123",
      title: "Ship kanban view",
      description: "Implement the first board route.",
      column: "Todo",
      columnKey: "todo",
      priority: "high",
      sortOrder: 3,
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T01:00:00.000Z",
      runStatus: "idle",
      activeRunId: null,
      workspacePath: null,
      latestActivity: null,
      lastError: null,
    });

    expect(parsed.labels).toEqual([]);
    expect(parsed.blockedBy).toEqual([]);
    expect(parsed.column).toBe("Todo");
    expect(parsed.columnKey).toBe("todo");
    expect(parsed.sortOrder).toBe(3);
  });
});

describe("UpdateProjectTaskInput", () => {
  it("decodes task edits", () => {
    const parsed = decodeUpdateProjectTaskInput({
      taskId: "task-1",
      identifier: "ABC-123",
      title: "Ship task detail view",
      description: null,
      priority: "high",
      labels: ["board"],
      blockedBy: [],
    });

    expect(parsed.taskId).toBe("task-1");
    expect(parsed.priority).toBe("high");
  });
});

describe("ProjectTaskRun", () => {
  it("decodes run summaries with artifacts and verification", () => {
    const parsed = decodeProjectTaskRun({
      id: "run-1",
      taskId: "task-1",
      projectId: "project-1",
      status: "running",
      attempt: 2,
      workspacePath: "/srv/t3code/workspaces/task-1",
      latestActivity: "Codex is applying the board layout patch.",
      lastError: null,
      startedAt: "2026-05-20T01:00:00.000Z",
      updatedAt: "2026-05-20T01:05:00.000Z",
      finishedAt: null,
      runtimeMs: 300000,
      tokenUsage: {
        inputTokens: 1200,
        outputTokens: 450,
        totalTokens: 1650,
      },
      artifacts: [
        {
          id: "artifact-1",
          kind: "log",
          label: "run.log",
          path: "/srv/t3code/logs/run.log",
          createdAt: "2026-05-20T01:05:00.000Z",
        },
      ],
      verification: {
        status: "running",
        commands: [{ command: "bun run typecheck", status: "pending", detail: null }],
        screenshots: [{ kind: "screenshot", label: "board", path: "/tmp/board.png" }],
      },
    });

    expect(parsed.tokenUsage?.totalTokens).toBe(1650);
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.verification?.screenshots).toHaveLength(1);
  });
});

describe("ProjectTaskVerificationSummary", () => {
  it("defaults commands and screenshots to empty arrays", () => {
    const parsed = decodeProjectTaskVerificationSummary({
      status: "not_requested",
    });

    expect(parsed.commands).toEqual([]);
    expect(parsed.screenshots).toEqual([]);
  });
});

describe("ProjectTaskBoardSnapshot", () => {
  it("decodes grouped board snapshots", () => {
    const parsed = decodeProjectTaskBoardSnapshot({
      projectId: "project-1",
      columns: [
        {
          key: "todo",
          label: "Todo",
          tasks: [
            {
              id: "task-1",
              projectId: "project-1",
              identifier: "ABC-123",
              title: "Ship kanban view",
              description: null,
              column: "Todo",
              columnKey: "todo",
              priority: "medium",
              sortOrder: 0,
              createdAt: "2026-05-20T00:00:00.000Z",
              updatedAt: "2026-05-20T01:00:00.000Z",
              runStatus: "queued",
              activeRunId: "run-1",
              workspacePath: null,
              latestActivity: "Queued for dispatch.",
              lastError: null,
            },
          ],
        },
      ],
      activeRunCount: 1,
      updatedAt: "2026-05-20T01:05:00.000Z",
    });

    expect(parsed.columns[0]?.tasks[0]?.identifier).toBe("ABC-123");
    expect(parsed.activeRunCount).toBe(1);
  });
});

describe("ReorderProjectTasksInput", () => {
  it("decodes ordered task ids for a column", () => {
    const parsed = decodeReorderProjectTasksInput({
      projectId: "project-1",
      columnKey: "todo",
      orderedTaskIds: ["task-2", "task-1"],
    });

    expect(parsed.orderedTaskIds).toEqual(["task-2", "task-1"]);
  });
});

describe("ProjectTaskRun control inputs", () => {
  it("decodes start/stop/retry task run inputs", () => {
    expect(
      decodeStartProjectTaskRunInput({
        taskId: "task-1",
        instanceId: "codex",
      }),
    ).toEqual({
      taskId: "task-1",
      instanceId: "codex",
    });

    expect(decodeStopProjectTaskRunInput({ taskId: "task-1" })).toEqual({
      taskId: "task-1",
    });

    expect(
      decodeRetryProjectTaskRunInput({
        taskId: "task-1",
      }),
    ).toEqual({
      taskId: "task-1",
    });
  });
});

describe("ProjectTaskAssistant", () => {
  it("decodes assistant requests and responses", () => {
    expect(
      decodeProjectTaskAssistantRequest({
        projectId: "project-1",
        message: "Create task ABC-124: Add assistant sidebar in Todo",
      }),
    ).toEqual({
      projectId: "project-1",
      message: "Create task ABC-124: Add assistant sidebar in Todo",
    });

    expect(
      decodeProjectTaskAssistantResponse({
        reply: "Created task ABC-124 in Todo.",
        toolCalls: [
          {
            toolName: "create_task",
            summary: "Created task ABC-124 in Todo.",
          },
        ],
      }),
    ).toEqual({
      reply: "Created task ABC-124 in Todo.",
      toolCalls: [
        {
          toolName: "create_task",
          summary: "Created task ABC-124 in Todo.",
        },
      ],
    });
  });
});
