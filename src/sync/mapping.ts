// Local records use camelCase; Postgres columns use snake_case.
// The mapping is mechanical so new fields only need a matching column in a migration.

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export type RemoteRow = Record<string, unknown>;

/** Server-managed columns that never exist locally. */
const SERVER_ONLY = new Set(['user_id', 'sync_seq']);

export function toRemoteRow(record: object, userId: string): RemoteRow {
  const row: RemoteRow = { user_id: userId };
  for (const [k, v] of Object.entries(record)) row[camelToSnake(k)] = v ?? null;
  return row;
}

export function fromRemoteRow<T>(row: RemoteRow): T {
  const rec: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!SERVER_ONLY.has(k)) rec[snakeToCamel(k)] = v;
  return rec as T;
}
