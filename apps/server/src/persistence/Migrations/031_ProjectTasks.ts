import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_tasks (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      identifier TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      column_label TEXT NOT NULL,
      column_key TEXT NOT NULL,
      priority TEXT NOT NULL,
      labels_json TEXT NOT NULL,
      blocked_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      run_status TEXT NOT NULL,
      active_run_id TEXT,
      workspace_path TEXT,
      latest_activity TEXT,
      last_error TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_task_runs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      workspace_path TEXT,
      latest_activity TEXT,
      last_error TEXT,
      started_at TEXT,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      runtime_ms INTEGER,
      token_usage_json TEXT,
      artifacts_json TEXT NOT NULL,
      verification_json TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_tasks_project_column_updated
    ON project_tasks(project_id, column_key, updated_at)
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_tasks_project_identifier
    ON project_tasks(project_id, identifier)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_tasks_active_run
    ON project_tasks(active_run_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_task_runs_project_updated
    ON project_task_runs(project_id, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_task_runs_task_updated
    ON project_task_runs(task_id, updated_at)
  `;
});
