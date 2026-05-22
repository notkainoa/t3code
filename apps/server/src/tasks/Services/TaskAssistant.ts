import {
  ProjectTask,
  ProjectTaskAssistantError,
  ProjectTaskAssistantResponse,
  type ProjectTaskAssistantToolName,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export const TASK_ASSISTANT_SYSTEM_PROMPT = `You are the t3code board assistant. You help the user organize project tasks.
You may only manage projects, tasks, columns, priorities, labels, blockers, and task descriptions
through the provided task tools.
You must not edit code, run shell commands, read or write files, inspect secrets, access arbitrary
MCP tools, or change the host machine.
If the user asks for code execution or filesystem work, create or update a task for the Codex worker
instead of doing the work yourself.`;

export interface TaskAssistantToolCallResult {
  readonly toolName: ProjectTaskAssistantToolName;
  readonly summary: string;
}

export interface TaskAssistantShape {
  readonly respond: (input: {
    readonly projectId: ProjectTask["projectId"];
    readonly message: string;
  }) => Effect.Effect<ProjectTaskAssistantResponse, ProjectTaskAssistantError>;
  readonly invokeTool: (input: {
    readonly toolName: string;
    readonly projectId: ProjectTask["projectId"];
    readonly args: Record<string, unknown>;
  }) => Effect.Effect<TaskAssistantToolCallResult, ProjectTaskAssistantError>;
}

export class TaskAssistant extends Context.Service<TaskAssistant, TaskAssistantShape>()(
  "t3/tasks/Services/TaskAssistant",
) {}
