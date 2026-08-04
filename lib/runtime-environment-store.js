import { AsyncLocalStorage } from "node:async_hooks";

const runtimeEnvironmentStorage = new AsyncLocalStorage();

export function runWithMed250RuntimeEnvironmentStore(environment, callback) {
  return runtimeEnvironmentStorage.run({
    NEXT_PUBLIC_SUPABASE_URL: environment?.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || undefined,
  }, callback);
}

export function getMed250RuntimeEnvironmentStore() {
  return runtimeEnvironmentStorage.getStore();
}
