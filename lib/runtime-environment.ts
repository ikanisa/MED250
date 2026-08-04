import { AsyncLocalStorage } from "node:async_hooks";

export type Med250RuntimeEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

const runtimeEnvironmentStorage = new AsyncLocalStorage<Med250RuntimeEnvironment>();

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
  return runtimeEnvironmentStorage.run({
    NEXT_PUBLIC_SUPABASE_URL: environment?.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || undefined,
  }, callback);
}

export function getMed250RuntimeEnvironment(): Med250RuntimeEnvironment | undefined {
  return runtimeEnvironmentStorage.getStore();
}
