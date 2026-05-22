# PLAN: VPS Service, Symphony Runner, and Project Kanban

## Objective

Turn t3code into a long-running service that can run on a VPS, be operated through the hosted/web
UI, and execute project tasks with Codex in isolated per-task workspaces. Add a project kanban view
for long-running background work, keep the existing provider UI shape for future providers, and
ship a safe task-management assistant that can only manage tasks.

This plan is intentionally self-contained. The implementation agent should also inspect:

- `README.md`
- `.docs/architecture.md`
- `.docs/remote-architecture.md`
- `.docs/workspace-layout.md`
- `REMOTE.md`
- `/home/ubuntu/github/symphony/SPEC.md` if present
- `packages/effect-codex-app-server/src/_generated/schema.gen.ts`
- the generated Codex app-server schema from the installed CLI

## Non-Negotiables

- Implement the work, tests, and screenshots. Do not stop at a design document.
- Preserve existing user data, routes, and provider registry concepts unless a migration is explicit.
- For now, only Codex may be runnable. Claude, OpenCode, Cursor, and any other provider UI must stay
  visible where appropriate but disabled as "Coming soon" or "Unavailable in service mode".
- Do not delete provider support code unless it is unreachable dead code and removing it is required
  by tests. Prefer feature gating over removal.
- The service runner must never launch Codex outside the task workspace assigned to that task.
- The task-management assistant must not have shell, filesystem, git, or arbitrary MCP access. It
  may only call a narrow server-side task API/tool allowlist.
- Every milestone below needs tests. Final completion requires full automated checks and Playwright
  screenshots.

## Target Product Behavior

### Hosted/VPS Mode

- A user can run a t3code backend on a VPS as a persistent service.
- The hosted/web version can connect to that backend using the existing remote environment and
  pairing model.
- The server remains the authority for projects, tasks, runs, artifacts, and provider execution.
- The web client renders the current state and sends typed commands over the existing HTTP/WebSocket
  contract.
- The service can keep working after the browser closes.

### Project Kanban

- Each project has a board with task columns.
- The board view hides the existing left sidebar completely. It should not be openable in board view.
- Project switching in board view happens through a top tab bar containing all of the user's
  projects.
- Clicking a task opens a task detail/work view.
- In task detail/work view:
  - the project tab bar remains at the top
  - the left sidebar returns
  - the left sidebar lists all tasks in the current project grouped and sorted by kanban column
  - the current task is highlighted
  - existing thread/work surfaces remain usable where they make sense
- Board columns should feel like a Linear-style work board: dense, scannable, and useful for
  long-running work rather than a marketing page.

### Task Assistant

- Board view has a right sidebar that can be toggled open/closed.
- The right sidebar is an AI assistant for task management.
- The assistant can add, edit, split, reorder, assign, and move tasks by using server-side tools.
- The assistant backend may use Codex, but it must be launched in a restricted assistant runtime:
  - no repository cwd
  - no arbitrary command execution
  - no arbitrary file reads/writes
  - no raw OS/MCP access
  - only a server-owned task tool allowlist
- The system prompt must make the boundary explicit: the assistant manages project tasks and board
  state only; it does not edit code, run commands, inspect secrets, or mutate the host.

### Task Execution

- Tasks can be started as background Codex runs.
- A running task should expose status, latest activity, tokens when available, runtime, retry state,
  logs, changed files/diffs/checkpoints when available, and verification artifacts.
- For UI or web-app tasks, the workflow must support Playwright-based verification and screenshots.
- A successful task run can end in a review/handoff column. It does not have to mean "Done".

## Symphony-Derived Service Contract

Use the Symphony spec as the policy and orchestration foundation, adapted to t3code's existing
server, contracts, provider, and remote-access architecture.

### Core Components

Implement or adapt these components in t3code:

1. `Workflow Loader`
   - Reads `WORKFLOW.md`.
   - Supports optional YAML front matter delimited by `---`.
   - Returns `{ config, promptTemplate }`.
   - Treats missing files, invalid YAML, and non-map front matter as typed errors.

2. `Config Layer`
   - Applies defaults.
   - Resolves `$VAR_NAME` only for config fields that explicitly support environment indirection.
   - Expands `~` and relative `workspace.root` paths.
   - Validates dispatch preconditions before startup and before each dispatch cycle.

3. `Task Tracker Client`
   - Initial implementation should use t3code's own project/task store as the default tracker.
   - Keep the adapter boundary compatible with future Linear support from the Symphony spec.
   - Required operations:
     - fetch candidate tasks in active columns/states
     - fetch tasks by state/column
     - fetch current states for running task IDs

4. `Orchestrator`
   - Owns the polling loop and all mutable runtime scheduling state.
   - Decides which tasks to dispatch, retry, stop, release, or clean up.
   - Enforces global and per-column concurrency.
   - Tracks running sessions, claimed tasks, retry queue, aggregate token/runtime totals, and latest
     rate-limit data.

5. `Workspace Manager`
   - Maps task identifiers to sanitized workspace directories.
   - Creates and reuses per-task workspaces.
   - Runs lifecycle hooks.
   - Cleans workspaces for terminal tasks when policy requires it.

6. `Agent Runner`
   - Builds a prompt from the workflow template and task data.
   - Launches Codex app-server in the per-task workspace.
   - Streams Codex events back into orchestrator state.
   - Runs continuation turns when the task remains active, up to the configured max turn count.

7. `Observability Surface`
   - Reuse t3code's web UI and server push system.
   - Add API/WS state needed by the board, task detail, and run/artifact views.
   - Structured logs must include task/project/session context.

### Workflow File Format

Support `WORKFLOW.md` with optional YAML front matter:

```md
---
tracker:
  kind: t3code
  active_states: ["Todo", "In Progress"]
  terminal_states: ["Done", "Cancelled", "Canceled", "Duplicate"]
polling:
  interval_ms: 30000
workspace:
  root: ~/.t3code/workspaces
agent:
  max_concurrent_agents: 3
  max_turns: 20
  max_retry_backoff_ms: 300000
codex:
  command: codex app-server
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
verification:
  commands:
    - bun run typecheck
    - bun run test
  screenshots:
    enabled: true
---

You are working on task {{ task.identifier }}: {{ task.title }}.

Use the project workflow, make focused changes, run verification, and leave the task in a
review-ready state with artifacts.
```

Front matter keys to support now:

- `tracker`
- `polling`
- `workspace`
- `hooks`
- `agent`
- `codex`
- `verification`

Unknown top-level keys should be ignored for forward compatibility.

### Config Defaults

Implement these defaults unless existing t3code settings already provide an equivalent value:

- `tracker.kind`: `t3code`
- `tracker.active_states`: `["Todo", "In Progress"]`
- `tracker.terminal_states`: `["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]`
- `polling.interval_ms`: `30000`
- `workspace.root`: app-data temp or state directory under `t3code/workspaces`
- `hooks.timeout_ms`: `60000`
- `agent.max_concurrent_agents`: `3` for the first shipped version
- `agent.max_turns`: `20`
- `agent.max_retry_backoff_ms`: `300000`
- `agent.max_concurrent_agents_by_state`: `{}`
- `codex.command`: `codex app-server`
- `codex.turn_timeout_ms`: `3600000`
- `codex.read_timeout_ms`: `5000`
- `codex.stall_timeout_ms`: `300000`

Codex approval/sandbox fields must be pass-through values compatible with the installed Codex
app-server. Do not create a stale hand-maintained enum. Before implementing the runner, run:

```bash
codex app-server generate-json-schema --out .tmp/codex-app-server-schema
```

Then inspect `v2/ThreadStartParams.json`, `v2/TurnStartParams.json`, and the local
`packages/effect-codex-app-server` generated schemas. If the installed protocol differs from the
repo wrapper, update the wrapper or add compatibility code before relying on it.

### Dynamic Reload

- Detect `WORKFLOW.md` changes.
- Re-read and re-apply workflow config and prompt without server restart.
- Apply changed config to future dispatch, retry scheduling, reconciliation, hook execution, and
  agent launches.
- Do not automatically restart in-flight Codex runs unless an explicit policy is added.
- Invalid reloads must keep the last known good config and emit an operator-visible error.

### Task Model

Add or extend contracts so tasks have at least:

- `id`
- `projectId`
- `identifier`
- `title`
- `description`
- `column`
- `priority`
- `labels`
- `blockedBy`
- `createdAt`
- `updatedAt`
- `runStatus`
- `activeRunId`
- `workspacePath` if known
- `latestActivity`
- `lastError`

Columns should be configurable per project later, but the first version can ship with:

- `Backlog`
- `Todo`
- `In Progress`
- `Review`
- `Done`

Use normalized lowercase comparisons for orchestration, but keep display labels human-readable.

### Workspace Safety

Mandatory invariants:

- Derive the workspace directory from the task identifier by replacing every character outside
  `[A-Za-z0-9._-]` with `_`.
- Normalize `workspace.root` and the task workspace path to absolute paths.
- Require the task workspace path to remain inside `workspace.root`.
- Before launching Codex, validate that the process cwd is exactly the task workspace path.
- Run hooks with the workspace path as cwd.
- Never destructively reset reused workspaces unless a future explicit policy says so.

Hooks:

- `hooks.after_create`: only for new workspace directories; failure aborts workspace creation.
- `hooks.before_run`: before each attempt; failure aborts the attempt.
- `hooks.after_run`: after each attempt; failure is logged and ignored.
- `hooks.before_remove`: before cleanup; failure is logged and ignored.
- Hook execution must respect `hooks.timeout_ms`.

### Orchestration State Machine

Use these internal states:

- `Unclaimed`
- `Claimed`
- `Running`
- `RetryQueued`
- `Released`

Run attempt phases:

- `PreparingWorkspace`
- `BuildingPrompt`
- `LaunchingAgentProcess`
- `InitializingSession`
- `StreamingTurn`
- `Verifying`
- `CapturingArtifacts`
- `Finishing`
- `Succeeded`
- `Failed`
- `TimedOut`
- `Stalled`
- `CanceledByReconciliation`

Poll tick sequence:

1. Reconcile running tasks.
2. Validate workflow/config for dispatch.
3. Fetch candidate tasks in active columns.
4. Sort by priority, created time, then identifier.
5. Dispatch eligible tasks while slots remain.
6. Publish state changes to API/WS/UI.

Eligibility:

- Has id, identifier, title, project id, and column.
- Column/state is active and not terminal.
- Not running and not claimed.
- Global concurrency slot is available.
- Per-column concurrency slot is available.
- Blockers are terminal before dispatching a `Todo` task.

Retry behavior:

- Normal worker exit schedules a short continuation retry after about `1000ms`.
- Failure retries use `min(10000 * 2^(attempt - 1), agent.max_retry_backoff_ms)`.
- Slot exhaustion requeues with an explicit `no available orchestrator slots` error.
- Retry timers do not need to survive process restart in the first version.

Reconciliation:

- Stall detection uses the latest Codex event timestamp, falling back to run start time.
- If `codex.stall_timeout_ms <= 0`, stall detection is disabled.
- Terminal task state stops the run and cleans workspace if cleanup policy says to.
- Non-active, non-terminal task state stops the run without workspace cleanup.
- Tracker/state refresh failures keep current workers running and retry later.

### Codex Runner

- Codex is the only runnable provider for this plan.
- Launch with `bash -lc <codex.command>` in the task workspace.
- Follow the installed Codex app-server protocol exactly.
- Extract `thread_id`, `turn_id`, and emit `session_id = "<thread_id>-<turn_id>"`.
- Reuse the same thread for continuation turns inside one worker lifetime.
- First turn uses the rendered task prompt.
- Continuation turns use short continuation guidance, not the full original prompt.
- User-input-required signals must not stall forever. For the first version, fail the run with a
  typed `turn_input_required` error and retry according to policy.
- Unsupported dynamic tool calls must return a structured tool failure instead of stalling.
- Track token totals from absolute/cumulative usage events where available. Avoid double-counting
  delta payloads.

### Verification and Artifacts

Each run should be able to collect:

- structured run logs
- command outputs
- Codex event summaries
- token/runtime totals
- changed file summaries or checkpoint references already available in t3code
- verification command results
- screenshot artifact paths for UI tasks

Implement `verification.commands` from `WORKFLOW.md` as optional post-turn commands run inside the
workspace. These commands must obey the same workspace cwd invariant. Store outputs in a per-run
artifact directory, for example:

```text
<app-data>/runs/<project-id>/<task-id>/<run-id>/
  codex.log
  verification.json
  artifacts/
    screenshot-*.png
```

For screenshots, support a first implementation that records paths produced by the task/agent or a
configured Playwright script. Do not block the entire service on screenshot capture if a screenshot
step is not configured.

## Implementation Milestones

### Milestone 1: Inventory and Protocol Verification

Tasks:

- Map current project, thread, provider, remote environment, persistence, and orchestration code.
- Run Codex schema generation and compare it with `effect-codex-app-server`.
- Identify the safest insertion points for the task store, board routes, service orchestrator, and
  Codex runner.
- Write a short implementation note in `.plans/` if any major repo assumption differs from this
  plan.

Tests:

- No product tests required beyond existing smoke checks.
- Record the schema verification command/result in the final summary.

### Milestone 2: Codex-Only Runtime Gate, Future Provider UI

Tasks:

- Add a central capability gate that marks Codex runnable and marks other providers disabled in
  service/kanban execution mode.
- Keep settings/provider screens recognizable, but show "Coming soon" or "Unavailable in service
  mode" for non-Codex providers.
- Ensure task execution cannot select a disabled provider.
- Preserve existing provider config data and migration behavior.

Tests:

- Unit tests for provider availability/capability gating.
- UI/component tests showing non-Codex providers render disabled messaging.
- Server tests that reject task-run requests for non-Codex providers.

### Milestone 3: Project Task Domain and Persistence

Tasks:

- Add shared contracts for projects, board columns, tasks, task mutations, run summaries, and
  artifact summaries.
- Add server persistence for tasks and columns using the existing persistence pattern.
- Add HTTP/WS/API commands for:
  - list projects
  - list board tasks for a project
  - create task
  - update task
  - move task between columns
  - reorder task within a column
  - start/stop/retry task run
  - fetch task detail/debug state
- Seed or migrate existing projects into the board model where appropriate.

Tests:

- Contract decode/encode tests.
- Persistence migration tests.
- API tests for task CRUD, move/reorder, and invalid input.
- Web state tests for grouping tasks by project and column.

### Milestone 4: Kanban Board UI

Tasks:

- Add a project board route.
- Hide the left sidebar entirely on the board route.
- Add a top project tab bar that is visible in board and task detail views.
- Render columns with stable widths, predictable drag/drop or move controls, and dense task cards.
- Add task create/edit affordances.
- Add run status indicators on task cards.
- Keep the design work-focused and consistent with existing t3code UI.

Tests:

- Component/logic tests for board grouping, sorting, empty columns, and selected project tab.
- Browser tests for board rendering and navigation.
- Accessibility checks for keyboard focus on tabs, task cards, and move controls where feasible.

Required screenshots:

- `artifacts/screenshots/kanban-board-desktop.png` at about `1440x900`.
- `artifacts/screenshots/kanban-board-mobile.png` at about `390x844`.
- `artifacts/screenshots/kanban-empty-state.png` for a project with no tasks.

### Milestone 5: Task Detail Layout and Sidebar Behavior

Tasks:

- Add task detail/work route.
- Keep project tabs at the top.
- Restore the left sidebar in task detail view.
- Change the sidebar content in task detail view so it lists the current project's tasks grouped by
  kanban column.
- Preserve existing thread/session UI where it is still relevant.
- Show task run status, latest activity, artifacts, logs, and verification results.

Tests:

- Sidebar logic tests for grouped task lists and active task selection.
- Route tests for board -> task detail -> board navigation.
- Browser tests that verify the sidebar is absent on board view and present on task detail view.

Required screenshots:

- `artifacts/screenshots/task-detail-desktop.png` at about `1440x900`.
- `artifacts/screenshots/task-detail-mobile.png` at about `390x844`.

### Milestone 6: Restricted Task Assistant

Tasks:

- Add the toggleable right sidebar assistant to board view.
- Define a server-side task-management tool interface with only:
  - `list_projects`
  - `list_project_tasks`
  - `create_task`
  - `update_task`
  - `move_task`
  - `reorder_task`
  - `split_task`
  - `summarize_board`
- Add a restrictive assistant system prompt:

```text
You are the t3code board assistant. You help the user organize project tasks.
You may only manage projects, tasks, columns, priorities, labels, blockers, and task descriptions
through the provided task tools.
You must not edit code, run shell commands, read or write files, inspect secrets, access arbitrary
MCP tools, or change the host machine.
If the user asks for code execution or filesystem work, create or update a task for the Codex worker
instead of doing the work yourself.
```

- If Codex app-server is used for this assistant, launch it in an empty scratch cwd under app data
  with no repository mounted and advertise only the task tools.
- If the installed Codex protocol cannot enforce the tool boundary, implement a non-Codex
  deterministic assistant stub for task CRUD and leave model-backed assistant disabled with a clear
  message until it can be secured.

Tests:

- Unit tests for the assistant tool allowlist.
- Tests proving disallowed tool names fail.
- Tests proving task mutations go through normal validation and authorization.
- Browser tests for opening/closing the assistant and creating/moving a task through it.

Required screenshot:

- `artifacts/screenshots/kanban-assistant-open.png` at about `1440x900`.

### Milestone 7: Symphony Workflow Loader, Config, and Workspace Manager

Tasks:

- Implement `WORKFLOW.md` discovery, parsing, strict template rendering, config defaults, and typed
  errors.
- Implement dynamic reload with last-known-good behavior.
- Implement workspace creation/reuse, sanitization, root containment, and hooks.
- Add service configuration surfaces needed for VPS/headless mode.

Tests:

- Workflow parse tests for no front matter, valid front matter, invalid YAML, and non-map YAML.
- Strict template tests for `task` and `attempt`.
- Env/path resolution tests for `$VAR`, `~`, relative workspace roots, and missing env vars.
- Dynamic reload tests for valid and invalid reloads.
- Workspace safety tests for sanitization, root containment, hooks, and hook timeouts.

### Milestone 8: Orchestrator and Codex Background Runs

Tasks:

- Implement the single-authority orchestrator state.
- Add polling, dispatch, claim tracking, retries, continuation retries, stall detection, and
  reconciliation.
- Wire the orchestrator to the t3code task tracker adapter.
- Implement the Codex app-server runner with event streaming, timeout handling, user-input failure,
  unsupported-tool failure, token/rate-limit extraction, and run finalization.
- Push runtime updates to the web UI through existing server push paths.

Tests:

- Orchestrator tests for sorting, blockers, active/terminal columns, claims, retries, slot
  exhaustion, per-column concurrency, stall detection, and reconciliation.
- Fake Codex runner tests for success, failure, timeout, cancellation, unsupported tools, user input,
  token updates, and continuation turns.
- Integration tests with a fake task store and fake runner.
- A smoke test that starts a real Codex run only when explicitly enabled and credentials/CLI are
  available. Skip this test by default when prerequisites are absent.

### Milestone 9: Verification, Artifacts, and Run Debug UI

Tasks:

- Add per-run artifact directories.
- Capture Codex logs and normalized recent events.
- Run optional verification commands from workflow config.
- Record verification results and artifact metadata.
- Show artifacts, logs, verification, and latest errors in task detail.
- Add API equivalents inspired by Symphony:
  - `GET /api/v1/state`
  - `GET /api/v1/tasks/:taskIdentifier`
  - `POST /api/v1/refresh`
    Existing t3code API naming can differ if contracts are typed and documented.

Tests:

- Artifact path tests to keep artifacts inside app data.
- Verification command success/failure/timeout tests.
- API tests for state, task detail, unknown task, and refresh.
- UI tests for rendering logs, verification status, and artifact links.

### Milestone 10: VPS/Hosted Operation

Tasks:

- Ensure headless server mode works without the desktop shell.
- Document how to run the service on a VPS, including bind host, port, auth, data directory,
  workspace root, and reverse proxy notes.
- Ensure hosted web pairing/remote environment flows work with the service backend.
- Add health/readiness state for the orchestrator, workflow config, Codex availability, and task
  store.
- Ensure secrets are never logged.

Tests:

- Server startup tests for missing/invalid config and clean startup.
- Remote access tests for hosted/static origin assumptions.
- Auth tests for task APIs and WS pushes.
- Manual smoke from hosted/web client to local service backend if a real hosted environment is not
  available in CI.

## Final Verification Gate

Before declaring the plan complete, run all feasible checks from the repo root:

```bash
bun install
bun run fmt:check
bun run lint
bun run typecheck
bun run test
bun run build
bun --filter @t3tools/web test:browser:install
bun --filter @t3tools/web test:browser
```

If any command is too slow or blocked by missing external credentials, document the exact command,
the reason it could not run, and the risk.

Then start the app locally and verify with Playwright:

```bash
bun run dev
```

Using Playwright interactive/browser automation, exercise and screenshot:

1. Project board with multiple columns and tasks.
2. Project board on a mobile viewport.
3. Board with the assistant sidebar open.
4. Task detail view with top project tabs and the grouped left task sidebar visible.
5. Task detail view on a mobile viewport.
6. Provider/settings UI showing Codex enabled and other providers disabled as coming soon.
7. A task run/debug view showing run status and verification/artifact surfaces.

Save screenshots under:

```text
artifacts/screenshots/
```

The implementation is not done until:

- Codex is the only runnable provider for task execution.
- Future providers remain represented in UI as coming soon/disabled.
- Board view hides the left sidebar and uses top project tabs.
- Task detail restores the left sidebar grouped by kanban column and keeps top project tabs.
- Assistant sidebar is toggleable and restricted to task-management tools only.
- Background Codex task runs use per-task isolated workspaces.
- Workflow/config reload, retries, reconciliation, artifacts, and observability are implemented.
- Tests cover each milestone's behavior.
- Playwright screenshots exist and show the required views.
- Final verification commands have been run or explicitly reported with blockers.

## Suggested `/goal` Prompt

```text
/goal Implement PLAN.md in /home/ubuntu/github/t3code without stopping until the VPS service mode,
Codex-only Symphony-style background task runner, project kanban UI, restricted task assistant,
tests, and Playwright screenshots are complete. Create or update tests for every milestone, run the
final verification commands in PLAN.md, start the app, verify the required views with Playwright
interactive/browser automation, and save screenshots under artifacts/screenshots/.
```
