import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE project_tasks
    ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_tasks_project_column_sort
    ON project_tasks(project_id, column_key, sort_order, updated_at)
  `;
});
