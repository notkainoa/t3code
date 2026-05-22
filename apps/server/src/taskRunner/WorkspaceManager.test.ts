import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  ProcessRunner,
  ProcessTimeoutError,
  layer as ProcessRunnerLive,
} from "../processRunner.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import {
  makeTaskWorkspaceManager,
  sanitizeTaskWorkspaceKey,
  TaskWorkspaceCwdMismatchError,
  TaskWorkspaceHookError,
  TaskWorkspaceHookTimeoutError,
  TaskWorkspaceManager,
} from "./WorkspaceManager.ts";

const defaultHooks = {
  timeoutMs: 500,
  afterCreate: [],
  beforeRun: [],
  afterRun: [],
  beforeRemove: [],
} as const;

const TaskWorkspaceManagerLive = Layer.empty.pipe(
  Layer.provideMerge(Layer.effect(TaskWorkspaceManager, makeTaskWorkspaceManager)),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(ProcessRunnerLive),
  Layer.provideMerge(NodeServices.layer),
);

const TaskWorkspaceManagerTimeoutLayer = Layer.empty.pipe(
  Layer.provideMerge(Layer.effect(TaskWorkspaceManager, makeTaskWorkspaceManager)),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(
    Layer.succeed(
      ProcessRunner,
      ProcessRunner.of({
        run: () =>
          Effect.fail(
            new ProcessTimeoutError({
              command: "bash",
              args: [],
              cwd: undefined,
              timeoutMs: 10,
            }),
          ),
      }),
    ),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-task-workspace-",
  });
});

function expectFailureCauseInstance(
  exit: Exit.Exit<unknown, unknown>,
  errorClass: abstract new (...args: ReadonlyArray<any>) => Error,
) {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toBeInstanceOf(errorClass);
  }
}

it.layer(TaskWorkspaceManagerLive)("TaskWorkspaceManager", (it) => {
  describe("sanitizeTaskWorkspaceKey", () => {
    it("replaces disallowed characters", () => {
      expect(sanitizeTaskWorkspaceKey("ABC-123: board/fix")).toBe("ABC-123__board_fix");
    });
  });

  describe("prepareWorkspace", () => {
    it.effect("creates sanitized task workspaces inside the root", () =>
      Effect.gen(function* () {
        const manager = yield* TaskWorkspaceManager;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* makeTempDir;

        const prepared = yield* manager.prepareWorkspace({
          workspaceRoot: root,
          taskIdentifier: "ABC-123: board/fix",
          hooks: defaultHooks,
        });
        const stat = yield* fileSystem.stat(prepared.workspacePath);
        const expectedWorkspacePath = path.join(prepared.workspaceRoot, "ABC-123__board_fix");

        expect(prepared.workspaceKey).toBe("ABC-123__board_fix");
        expect(prepared.workspacePath).toBe(expectedWorkspacePath);
        expect(prepared.createdNow).toBe(true);
        expect(stat.type).toBe("Directory");
      }),
    );

    it.effect("reuses existing workspaces without rerunning after_create", () =>
      Effect.gen(function* () {
        const manager = yield* TaskWorkspaceManager;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* makeTempDir;
        const sentinel = path.join(root, "ABC-123", "sentinel.txt");

        const first = yield* manager.prepareWorkspace({
          workspaceRoot: root,
          taskIdentifier: "ABC-123",
          hooks: {
            ...defaultHooks,
            afterCreate: ["printf created > sentinel.txt"],
          },
        });
        const second = yield* manager.prepareWorkspace({
          workspaceRoot: root,
          taskIdentifier: "ABC-123",
          hooks: {
            ...defaultHooks,
            afterCreate: ["printf replaced > sentinel.txt"],
          },
        });

        expect(first.createdNow).toBe(true);
        expect(second.createdNow).toBe(false);
        expect(yield* fileSystem.readFileString(sentinel)).toBe("created");
      }),
    );

    it.effect("runs after_create hooks inside the workspace", () =>
      Effect.gen(function* () {
        const manager = yield* TaskWorkspaceManager;
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir;

        const prepared = yield* manager.prepareWorkspace({
          workspaceRoot: root,
          taskIdentifier: "ABC-123",
          hooks: {
            ...defaultHooks,
            afterCreate: ["pwd > hook.cwd"],
          },
        });

        expect(
          (yield* fileSystem.readFileString(`${prepared.workspacePath}/hook.cwd`))
            .trim()
            .endsWith("/ABC-123"),
        ).toBe(true);
      }),
    );

    it.effect("fails when after_create exceeds the hook timeout", () =>
      Effect.gen(function* () {
        const manager = yield* TaskWorkspaceManager;
        const root = yield* makeTempDir;

        const exit = yield* Effect.exit(
          manager.prepareWorkspace({
            workspaceRoot: root,
            taskIdentifier: "ABC-123",
            hooks: {
              ...defaultHooks,
              timeoutMs: 10,
              afterCreate: ["echo never-runs"],
            },
          }),
        );

        expectFailureCauseInstance(exit, TaskWorkspaceHookTimeoutError);
      }).pipe(Effect.provide(TaskWorkspaceManagerTimeoutLayer)),
    );
  });

  describe("runBeforeRunHooks", () => {
    it.effect("runs before_run hooks inside the workspace", () =>
      Effect.gen(function* () {
        const manager = yield* TaskWorkspaceManager;
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir;

        const prepared = yield* manager.prepareWorkspace({
          workspaceRoot: root,
          taskIdentifier: "ABC-123",
          hooks: defaultHooks,
        });
        yield* manager.runBeforeRunHooks({
          workspacePath: prepared.workspacePath,
          hooks: {
            ...defaultHooks,
            beforeRun: ["printf before-run > before-run.txt"],
          },
        });

        expect(yield* fileSystem.readFileString(`${prepared.workspacePath}/before-run.txt`)).toBe(
          "before-run",
        );
      }),
    );

    it.effect("surfaces command failures", () =>
      Effect.gen(function* () {
        const manager = yield* TaskWorkspaceManager;
        const root = yield* makeTempDir;
        const prepared = yield* manager.prepareWorkspace({
          workspaceRoot: root,
          taskIdentifier: "ABC-123",
          hooks: defaultHooks,
        });

        const exit = yield* Effect.exit(
          manager.runBeforeRunHooks({
            workspacePath: prepared.workspacePath,
            hooks: {
              ...defaultHooks,
              beforeRun: ["echo nope >&2; exit 5"],
            },
          }),
        );

        expectFailureCauseInstance(exit, TaskWorkspaceHookError);
      }),
    );
  });

  describe("assertWorkspaceCwd", () => {
    it.effect("accepts the exact workspace cwd", () =>
      Effect.gen(function* () {
        const manager = yield* TaskWorkspaceManager;
        const root = yield* makeTempDir;
        const prepared = yield* manager.prepareWorkspace({
          workspaceRoot: root,
          taskIdentifier: "ABC-123",
          hooks: defaultHooks,
        });

        yield* manager.assertWorkspaceCwd({
          expectedWorkspacePath: prepared.workspacePath,
          cwd: prepared.workspacePath,
        });
      }),
    );

    it.effect("rejects mismatched cwd values", () =>
      Effect.gen(function* () {
        const manager = yield* TaskWorkspaceManager;
        const root = yield* makeTempDir;
        const prepared = yield* manager.prepareWorkspace({
          workspaceRoot: root,
          taskIdentifier: "ABC-123",
          hooks: defaultHooks,
        });

        const exit = yield* Effect.exit(
          manager.assertWorkspaceCwd({
            expectedWorkspacePath: prepared.workspacePath,
            cwd: `${prepared.workspacePath}/nested`,
          }),
        );

        expectFailureCauseInstance(exit, TaskWorkspaceCwdMismatchError);
      }),
    );
  });
});
