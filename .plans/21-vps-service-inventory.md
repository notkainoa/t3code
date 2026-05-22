# VPS Service Inventory

Date: 2026-05-20

## Current-state findings

- The current web route tree is still chat/settings-only. There is no existing board/task route to extend.
- The server already has strong primitives we should reuse:
  - `apps/server/src/ws.ts` typed RPC boundary
  - `apps/server/src/orchestration/*` eventing, snapshots, and push plumbing
  - `apps/server/src/workspace/*` root/path safety helpers
  - `apps/server/src/provider/Layers/CodexSessionRuntime.ts` and `packages/effect-codex-app-server/*` for Codex runtime integration
- Existing project data is modeled through orchestration snapshots and bootstrap commands rather than a standalone project CRUD API. The kanban/task store should therefore be added as a separate server-owned domain instead of trying to overload thread/project event logs.
- `REMOTE.md` already documents headless `t3 serve` usage. The missing work is long-running task orchestration and a hosted-service task surface, not the initial remote pairing foundation.

## Codex schema verification

- Ran:
  - `codex app-server generate-json-schema --out .tmp/codex-app-server-schema`
- Verified the installed schema includes the fields this plan depends on:
  - `ThreadStartParams`: `cwd`, `approvalPolicy`, `approvalsReviewer`, `sandbox`, `serviceTier`, `model`, `personality`
  - `TurnStartParams`: `threadId`, `input`, `cwd`, `approvalPolicy`, `approvalsReviewer`, `effort`, `sandboxPolicy`, `serviceTier`, `personality`
- Compared that shape against `packages/effect-codex-app-server/src/_generated/schema.gen.ts`.
- The local wrapper already includes the newer approval and sandbox fields required for a restricted runner, so no compatibility patch was needed at this stage.

## Recommended insertion points

- `apps/server/src/taskRunner/`: workflow loader/config, workspace manager, orchestrator, Codex background runner
- `packages/contracts/src/`: task-board and run/artifact schemas plus RPC payloads
- `apps/server/src/ws.ts`: typed task RPC methods and push subscriptions
- `apps/web/src/routes/`: new board and task-detail routes
- `apps/web/src/components/`: board columns, task sidebar, assistant sidebar, run debug panels
