export const AGENTS_VXAPP_ROOT = "/home/gizmo/agents-vxapp";
export const AGENTS_VXAPP_DB_PATH = "/home/gizmo/agents-vxapp/.agents/state/vx_agents.sqlite3";
export const AGENTS_VXAPP_TODO_ROOT = "/home/gizmo/kb-vxapp/@Todos";

export type AgentsVxappSqliteRow = Record<string, unknown>;
export type AgentsVxappSqliteQueryAll = (sql: string) => AgentsVxappSqliteRow[];

type BunSqliteModule = typeof import("bun:sqlite");
type NodeSqliteModule = typeof import("node:sqlite");

function importRuntimeModule<T>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}

export async function withAgentsVxappSqliteReadonly<T>(
  execute: (queryAll: AgentsVxappSqliteQueryAll) => T | Promise<T>,
): Promise<T> {
  if (process.versions.bun !== undefined) {
    const sqlite = await importRuntimeModule<BunSqliteModule>("bun:sqlite");
    const database = new sqlite.Database(AGENTS_VXAPP_DB_PATH, { readonly: true });
    try {
      return await execute((sql) => database.query(sql).all() as AgentsVxappSqliteRow[]);
    } finally {
      database.close();
    }
  }

  const sqlite = await importRuntimeModule<NodeSqliteModule>("node:sqlite");
  const database = new sqlite.DatabaseSync(AGENTS_VXAPP_DB_PATH, { readOnly: true });
  try {
    return await execute((sql) => database.prepare(sql).all() as AgentsVxappSqliteRow[]);
  } finally {
    database.close();
  }
}
