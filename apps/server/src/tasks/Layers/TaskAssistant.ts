import {
  ProjectTaskAssistantError,
  type ProjectTask,
  type ProjectTaskAssistantResponse,
  type ProjectTaskAssistantToolName,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectTaskRepository } from "../../persistence/Services/ProjectTasks.ts";
import { TaskBoard } from "../Services/TaskBoard.ts";
import {
  TASK_ASSISTANT_SYSTEM_PROMPT,
  TaskAssistant,
  type TaskAssistantShape,
  type TaskAssistantToolCallResult,
} from "../Services/TaskAssistant.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const COLUMN_BY_NORMALIZED_VALUE = {
  backlog: { column: "Backlog", columnKey: "backlog" },
  todo: { column: "Todo", columnKey: "todo" },
  "in progress": { column: "In Progress", columnKey: "in_progress" },
  in_progress: { column: "In Progress", columnKey: "in_progress" },
  review: { column: "Review", columnKey: "review" },
  done: { column: "Done", columnKey: "done" },
} as const;

function normalizeWhitespace(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}

function normalizeIdentifier(value: string): string {
  return normalizeWhitespace(value).toUpperCase();
}

function normalizeColumn(value: string) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return COLUMN_BY_NORMALIZED_VALUE[normalized as keyof typeof COLUMN_BY_NORMALIZED_VALUE] ?? null;
}

function toAssistantError(message: string) {
  return (cause: unknown) =>
    new ProjectTaskAssistantError({
      message,
      cause,
    });
}

function maybePriority(value: unknown): ProjectTask["priority"] | null {
  return value === "none" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "urgent"
    ? value
    : null;
}

const makeTaskAssistant = Effect.gen(function* () {
  const taskBoard = yield* TaskBoard;
  const tasks = yield* ProjectTaskRepository;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const listProjectTasks = Effect.fn("TaskAssistant.listProjectTasks")(function* (
    projectId: ProjectTask["projectId"],
  ) {
    return yield* tasks
      .listByProject({ projectId })
      .pipe(Effect.mapError(toAssistantError("Failed to list project tasks.")));
  });

  const getTaskByIdentifier = Effect.fn("TaskAssistant.getTaskByIdentifier")(function* (input: {
    readonly projectId: ProjectTask["projectId"];
    readonly identifier: string;
  }) {
    const projectTasks = yield* listProjectTasks(input.projectId);
    const task = projectTasks.find(
      (candidate) =>
        normalizeIdentifier(candidate.identifier) === normalizeIdentifier(input.identifier),
    );
    if (!task) {
      return yield* new ProjectTaskAssistantError({
        message: `Unknown task identifier: ${input.identifier}`,
      });
    }
    return task;
  });

  const invokeTool: TaskAssistantShape["invokeTool"] = Effect.fn("TaskAssistant.invokeTool")(
    function* (input) {
      switch (input.toolName as ProjectTaskAssistantToolName | string) {
        case "list_projects": {
          const snapshot = yield* projectionSnapshotQuery
            .getSnapshot()
            .pipe(Effect.mapError(toAssistantError("Failed to load projects.")));
          const summary =
            snapshot.projects.length === 0
              ? "No projects are available."
              : `Projects: ${snapshot.projects.map((project) => project.title).join(", ")}.`;
          return {
            toolName: "list_projects",
            summary,
          } satisfies TaskAssistantToolCallResult;
        }
        case "list_project_tasks": {
          const projectTasks = yield* listProjectTasks(input.projectId);
          const summary =
            projectTasks.length === 0
              ? "This project has no tasks."
              : `Tasks: ${projectTasks.map((task) => `${task.identifier} (${task.column})`).join(", ")}.`;
          return {
            toolName: "list_project_tasks",
            summary,
          } satisfies TaskAssistantToolCallResult;
        }
        case "create_task": {
          const identifier =
            typeof input.args.identifier === "string"
              ? normalizeWhitespace(input.args.identifier)
              : "";
          const title =
            typeof input.args.title === "string" ? normalizeWhitespace(input.args.title) : "";
          const columnInput =
            typeof input.args.column === "string" ? normalizeColumn(input.args.column) : null;
          if (!identifier || !title) {
            return yield* new ProjectTaskAssistantError({
              message: "create_task requires identifier and title.",
            });
          }
          const created = yield* taskBoard
            .createTask({
              projectId: input.projectId,
              identifier,
              title,
              description:
                typeof input.args.description === "string"
                  ? normalizeWhitespace(input.args.description)
                  : null,
              column: columnInput?.column ?? "Todo",
              columnKey: columnInput?.columnKey ?? "todo",
              priority: maybePriority(input.args.priority) ?? "none",
              labels: Array.isArray(input.args.labels)
                ? input.args.labels.filter((entry): entry is string => typeof entry === "string")
                : [],
              blockedBy: [],
            })
            .pipe(Effect.mapError(toAssistantError("Failed to create task.")));
          return {
            toolName: "create_task",
            summary: `Created task ${created.identifier} in ${created.column}.`,
          } satisfies TaskAssistantToolCallResult;
        }
        case "update_task": {
          const task = yield* getTaskByIdentifier({
            projectId: input.projectId,
            identifier: String(input.args.identifier ?? ""),
          });
          const updated = yield* taskBoard
            .updateTask({
              taskId: task.id,
              identifier:
                typeof input.args.nextIdentifier === "string"
                  ? normalizeWhitespace(input.args.nextIdentifier)
                  : task.identifier,
              title:
                typeof input.args.title === "string"
                  ? normalizeWhitespace(input.args.title)
                  : task.title,
              description:
                typeof input.args.description === "string"
                  ? normalizeWhitespace(input.args.description)
                  : task.description,
              priority: maybePriority(input.args.priority) ?? task.priority,
              labels: Array.isArray(input.args.labels)
                ? input.args.labels.filter((entry): entry is string => typeof entry === "string")
                : task.labels,
              blockedBy: task.blockedBy,
            })
            .pipe(Effect.mapError(toAssistantError("Failed to update task.")));
          return {
            toolName: "update_task",
            summary: `Updated task ${updated.identifier}.`,
          } satisfies TaskAssistantToolCallResult;
        }
        case "move_task": {
          const task = yield* getTaskByIdentifier({
            projectId: input.projectId,
            identifier: String(input.args.identifier ?? ""),
          });
          const columnInput =
            typeof input.args.column === "string" ? normalizeColumn(input.args.column) : null;
          if (!columnInput) {
            return yield* new ProjectTaskAssistantError({
              message: "move_task requires a valid target column.",
            });
          }
          const moved = yield* taskBoard
            .moveTask({
              taskId: task.id,
              column: columnInput.column,
              columnKey: columnInput.columnKey,
            })
            .pipe(Effect.mapError(toAssistantError("Failed to move task.")));
          return {
            toolName: "move_task",
            summary: `Moved task ${moved.identifier} to ${moved.column}.`,
          } satisfies TaskAssistantToolCallResult;
        }
        case "reorder_task": {
          const identifier = String(input.args.identifier ?? "");
          const beforeIdentifier =
            typeof input.args.beforeIdentifier === "string" ? input.args.beforeIdentifier : null;
          const projectTasks = yield* listProjectTasks(input.projectId);
          const target = projectTasks.find(
            (task) => normalizeIdentifier(task.identifier) === normalizeIdentifier(identifier),
          );
          if (!target) {
            return yield* new ProjectTaskAssistantError({
              message: `Unknown task identifier: ${identifier}`,
            });
          }
          const columnTasks = projectTasks
            .filter((task) => task.columnKey === target.columnKey)
            .toSorted((left, right) => left.sortOrder - right.sortOrder);
          const orderedTaskIds = columnTasks
            .filter((task) => task.id !== target.id)
            .map((task) => task.id);
          if (beforeIdentifier) {
            const beforeTask = columnTasks.find(
              (task) =>
                normalizeIdentifier(task.identifier) === normalizeIdentifier(beforeIdentifier),
            );
            if (!beforeTask) {
              return yield* new ProjectTaskAssistantError({
                message: `Unknown task identifier: ${beforeIdentifier}`,
              });
            }
            orderedTaskIds.splice(
              orderedTaskIds.findIndex((taskId) => taskId === beforeTask.id),
              0,
              target.id,
            );
          } else {
            orderedTaskIds.push(target.id);
          }
          yield* taskBoard
            .reorderTasks({
              projectId: input.projectId,
              columnKey: target.columnKey,
              orderedTaskIds,
            })
            .pipe(Effect.mapError(toAssistantError("Failed to reorder task.")));
          return {
            toolName: "reorder_task",
            summary: `Reordered task ${target.identifier} in ${target.column}.`,
          } satisfies TaskAssistantToolCallResult;
        }
        case "split_task": {
          const task = yield* getTaskByIdentifier({
            projectId: input.projectId,
            identifier: String(input.args.identifier ?? ""),
          });
          const parts = Array.isArray(input.args.parts)
            ? input.args.parts
                .filter((entry): entry is string => typeof entry === "string")
                .map(normalizeWhitespace)
                .filter((entry) => entry.length > 0)
            : [];
          if (parts.length === 0) {
            return yield* new ProjectTaskAssistantError({
              message: "split_task requires at least one subtask title.",
            });
          }
          const existingTasks = yield* listProjectTasks(input.projectId);
          const existingIdentifiers = new Set(
            existingTasks.map((existingTask) => normalizeIdentifier(existingTask.identifier)),
          );
          for (const [index, part] of parts.entries()) {
            let candidateIndex = index + 1;
            let identifier = `${task.identifier}-${candidateIndex}`;
            while (existingIdentifiers.has(normalizeIdentifier(identifier))) {
              candidateIndex += 1;
              identifier = `${task.identifier}-${candidateIndex}`;
            }
            existingIdentifiers.add(normalizeIdentifier(identifier));
            yield* taskBoard
              .createTask({
                projectId: input.projectId,
                identifier,
                title: part,
                description: `Split from ${task.identifier}.`,
                column: task.column,
                columnKey: task.columnKey,
                priority: task.priority,
                labels: task.labels,
                blockedBy: [],
              })
              .pipe(Effect.mapError(toAssistantError("Failed to split task.")));
          }
          return {
            toolName: "split_task",
            summary: `Split task ${task.identifier} into ${parts.length} new task${parts.length === 1 ? "" : "s"}.`,
          } satisfies TaskAssistantToolCallResult;
        }
        case "summarize_board": {
          const board = yield* taskBoard
            .getBoard(input.projectId)
            .pipe(Effect.mapError(toAssistantError("Failed to summarize board.")));
          const summary = board.columns
            .map((column) => `${column.label}: ${column.tasks.length}`)
            .join(", ");
          return {
            toolName: "summarize_board",
            summary: `Board summary: ${summary}. Active runs: ${board.activeRunCount}.`,
          } satisfies TaskAssistantToolCallResult;
        }
        default:
          return yield* new ProjectTaskAssistantError({
            message: `Disallowed task assistant tool: ${input.toolName}`,
          });
      }
    },
  );

  const respond: TaskAssistantShape["respond"] = Effect.fn("TaskAssistant.respond")(
    function* (input) {
      const message = normalizeWhitespace(input.message);
      const createMatch =
        /^create task\s+([a-z0-9._-]+)\s*:\s*(.+?)(?:\s+in\s+(backlog|todo|in progress|review|done))?(?:\s+priority\s+(none|low|medium|high|urgent))?$/i.exec(
          message,
        );
      if (createMatch) {
        const toolCall = yield* invokeTool({
          toolName: "create_task",
          projectId: input.projectId,
          args: {
            identifier: createMatch[1],
            title: createMatch[2],
            column: createMatch[3],
            priority: createMatch[4],
          },
        });
        return {
          reply: `${toolCall.summary} ${TASK_ASSISTANT_SYSTEM_PROMPT.split("\n")[0]}`,
          toolCalls: [toolCall],
        } satisfies ProjectTaskAssistantResponse;
      }

      const moveMatch =
        /^move task\s+([a-z0-9._-]+)\s+to\s+(backlog|todo|in progress|review|done)$/i.exec(message);
      if (moveMatch) {
        const toolCall = yield* invokeTool({
          toolName: "move_task",
          projectId: input.projectId,
          args: {
            identifier: moveMatch[1],
            column: moveMatch[2],
          },
        });
        return {
          reply: toolCall.summary,
          toolCalls: [toolCall],
        } satisfies ProjectTaskAssistantResponse;
      }

      const splitMatch = /^split task\s+([a-z0-9._-]+)\s+into\s+(.+)$/i.exec(message);
      if (splitMatch) {
        const parts = (splitMatch[2] ?? "")
          .split("|")
          .map((entry) => normalizeWhitespace(entry))
          .filter((entry) => entry.length > 0);
        const toolCall = yield* invokeTool({
          toolName: "split_task",
          projectId: input.projectId,
          args: {
            identifier: splitMatch[1],
            parts,
          },
        });
        return {
          reply: toolCall.summary,
          toolCalls: [toolCall],
        } satisfies ProjectTaskAssistantResponse;
      }

      if (/^(summarize|summarize board|board summary)$/i.test(message)) {
        const toolCall = yield* invokeTool({
          toolName: "summarize_board",
          projectId: input.projectId,
          args: {},
        });
        return {
          reply: toolCall.summary,
          toolCalls: [toolCall],
        } satisfies ProjectTaskAssistantResponse;
      }

      if (/^(list tasks|list project tasks)$/i.test(message)) {
        const toolCall = yield* invokeTool({
          toolName: "list_project_tasks",
          projectId: input.projectId,
          args: {},
        });
        return {
          reply: toolCall.summary,
          toolCalls: [toolCall],
        } satisfies ProjectTaskAssistantResponse;
      }

      if (/^(list projects)$/i.test(message)) {
        const toolCall = yield* invokeTool({
          toolName: "list_projects",
          projectId: input.projectId,
          args: {},
        });
        return {
          reply: toolCall.summary,
          toolCalls: [toolCall],
        } satisfies ProjectTaskAssistantResponse;
      }

      const createdAt = yield* nowIso;
      return {
        reply:
          `Restricted task assistant only. ${TASK_ASSISTANT_SYSTEM_PROMPT.split("\n")[0]} ` +
          `Use commands like "create task ABC-124: Add sidebar in Todo", "move task ABC-124 to Review", ` +
          `"split task ABC-124 into Build UI | Add tests", "list tasks", or "summarize board". ` +
          `Request received at ${createdAt}.`,
        toolCalls: [],
      } satisfies ProjectTaskAssistantResponse;
    },
  );

  return TaskAssistant.of({
    respond,
    invokeTool,
  });
});

export const TaskAssistantLive = Layer.effect(TaskAssistant, makeTaskAssistant);
