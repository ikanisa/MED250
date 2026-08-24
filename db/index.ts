export type D1Row = Record<string, unknown>;

type D1Bindings = unknown[];

export class D1RepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "D1RepositoryError";
    this.code = code;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function futureIso(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function newReference(prefix: string): string {
  return `${prefix}-${newId().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

export function normalizedE164(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    throw new D1RepositoryError("invalid_e164", "Phone number must be a valid E.164 number.");
  }
  return digits;
}

function prepared(database: D1Database, sql: string, bindings: D1Bindings): D1PreparedStatement {
  return bindings.length ? database.prepare(sql).bind(...bindings) : database.prepare(sql);
}

export async function allRows<T extends D1Row>(
  database: D1Database,
  sql: string,
  bindings: D1Bindings = [],
): Promise<T[]> {
  const result = await prepared(database, sql, bindings).all<T>();
  if (!result.success) throw new D1RepositoryError("d1_query_failed", "D1 query failed.");
  return result.results;
}

export async function firstRow<T extends D1Row>(
  database: D1Database,
  sql: string,
  bindings: D1Bindings = [],
): Promise<T | null> {
  return prepared(database, sql, bindings).first<T>();
}

export async function runStatement(
  database: D1Database,
  sql: string,
  bindings: D1Bindings = [],
): Promise<D1Result<unknown>> {
  const result = await prepared(database, sql, bindings).run();
  if (!result.success) throw new D1RepositoryError("d1_write_failed", "D1 write failed.");
  return result;
}

export async function atomicBatch(
  database: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result<unknown>[]> {
  if (!statements.length) return [];
  const results = await database.batch(statements);
  if (results.some((result) => !result.success)) {
    throw new D1RepositoryError("d1_batch_failed", "D1 transaction failed.");
  }
  return results;
}

export function parseJsonObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "string") {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    throw new D1RepositoryError("invalid_database_json", `Database field ${field} is invalid.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new D1RepositoryError("invalid_database_json", `Database field ${field} is invalid.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new D1RepositoryError("invalid_database_json", `Database field ${field} is invalid.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseJsonArray(value: unknown, field: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") {
    throw new D1RepositoryError("invalid_database_json", `Database field ${field} is invalid.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new D1RepositoryError("invalid_database_json", `Database field ${field} is invalid.`);
  }
  if (!Array.isArray(parsed)) {
    throw new D1RepositoryError("invalid_database_json", `Database field ${field} is invalid.`);
  }
  return parsed;
}

export function d1Boolean(value: unknown, field: string): boolean {
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  throw new D1RepositoryError("invalid_database_boolean", `Database field ${field} is invalid.`);
}

export function inClause(count: number): string {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new D1RepositoryError("invalid_in_clause", "D1 IN clause size is invalid.");
  }
  return Array.from({ length: count }, () => "?").join(", ");
}
