import {
  getMed250RuntimeEnvironmentStore,
  runWithMed250RuntimeEnvironmentStore,
} from "./runtime-environment-store.js";

export type Med250RuntimeEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

/**
 * Cloudflare bindings are request-scoped. Keep the public values used by SSR
 * on the same runtime boundary instead of silently falling back to values
 * inlined during the build. A missing binding is intentionally represented by
 * an empty object so preview and unit-render requests fail closed.
 */
export function runWithMed250RuntimeEnvironment<T>(
  environment: Med250RuntimeEnvironment | undefined,
  callback: () => T,
): T {
  return runWithMed250RuntimeEnvironmentStore(environment, callback) as T;
}

export function getMed250RuntimeEnvironment(): Med250RuntimeEnvironment | undefined {
  return getMed250RuntimeEnvironmentStore() as Med250RuntimeEnvironment | undefined;
}
