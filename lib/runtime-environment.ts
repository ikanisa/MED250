export type Med250RuntimeEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

const runtimeStateKey = "__MED250_RUNTIME_ENVIRONMENT__";

type RuntimeGlobal = typeof globalThis & {
  [runtimeStateKey]?: Med250RuntimeEnvironment;
};

/**
 * Cloudflare bindings are request-scoped. Keep the public values used by SSR
 * on the same runtime boundary instead of silently falling back to values
 * inlined during the build. A missing binding is intentionally represented by
 * an empty object so preview and unit-render requests fail closed.
 */
export function setMed250RuntimeEnvironment(environment: Med250RuntimeEnvironment | undefined) {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal[runtimeStateKey] = {
    NEXT_PUBLIC_SUPABASE_URL: environment?.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || undefined,
  };
}

export function getMed250RuntimeEnvironment(): Med250RuntimeEnvironment | undefined {
  return (globalThis as RuntimeGlobal)[runtimeStateKey];
}
