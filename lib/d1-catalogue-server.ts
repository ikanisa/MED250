import { CatalogueRepository } from "../worker/backend/catalogue-repository.ts";
import { d1Database } from "../worker/backend/runtime-env.ts";

/**
 * Server Components use the request-scoped Cloudflare D1 binding. The binding
 * is never serialized into the browser bundle, and local preview safely returns
 * no dynamic enrichment when the Workers runtime module is unavailable.
 */
export const serverD1CatalogueConfigured =
  process.env.NEXT_PUBLIC_MED250_CATALOGUE_BACKEND === "worker-d1";

export async function withServerD1Database<T>(
  work: (database: D1Database) => Promise<T>,
): Promise<T | null> {
  if (!serverD1CatalogueConfigured) return null;
  try {
    const runtime = await import("cloudflare:workers");
    const workerEnv = runtime.env as unknown as Env;
    return await work(d1Database(workerEnv));
  } catch {
    return null;
  }
}

export async function withServerCatalogueRepository<T>(
  work: (repository: CatalogueRepository) => Promise<T>,
): Promise<T | null> {
  return withServerD1Database((database) => work(new CatalogueRepository(database)));
}
