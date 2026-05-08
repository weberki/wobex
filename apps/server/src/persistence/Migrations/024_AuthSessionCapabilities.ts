import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const OWNER_CAPABILITIES = JSON.stringify([
  "chat:read",
  "chat:write",
  "approvals:respond",
  "files:read",
  "files:write",
  "terminal:read",
  "terminal:write",
  "git:read",
  "git:write",
  "settings:admin",
  "auth:admin",
]);

const AGENT_CONTROL_CAPABILITIES = JSON.stringify([
  "chat:read",
  "chat:write",
  "approvals:respond",
  "files:read",
  "terminal:read",
  "git:read",
]);

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const sessionColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_sessions)
  `;

  if (!sessionColumns.some((column) => column.name === "capabilities_json")) {
    yield* sql`
      ALTER TABLE auth_sessions
      ADD COLUMN capabilities_json TEXT
    `;
  }

  yield* sql`
    UPDATE auth_sessions
    SET capabilities_json = CASE
      WHEN role = 'owner' THEN ${OWNER_CAPABILITIES}
      ELSE ${AGENT_CONTROL_CAPABILITIES}
    END
    WHERE capabilities_json IS NULL
      OR capabilities_json = ''
  `;
});
