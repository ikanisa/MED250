import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabaseConfigured = Boolean(url && key);

type Med250SupabaseGlobals = typeof globalThis & {
  __med250CustomerSupabase?: SupabaseClient;
  __med250PharmacySupabase?: SupabaseClient;
};

const shared = globalThis as Med250SupabaseGlobals;

export const customerSupabase = url && key
  ? shared.__med250CustomerSupabase ??= createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "med250-customer-auth",
    },
  })
  : null;

const PHARMACY_SESSION_KEY = "med250-pharmacy-auth";
const pharmacySessionStorage = {
  getItem(keyName: string): string | null {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(keyName);
  },
  setItem(keyName: string, value: string): void {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(keyName, value);
  },
  removeItem(keyName: string): void {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(keyName);
  },
};

export async function savePharmacySession(accessToken: string, refreshToken: string): Promise<void> {
  if (typeof window === "undefined") throw new Error("Pharmacy sign-in requires a browser.");
  if (!accessToken || !refreshToken) throw new Error("The pharmacy session is incomplete.");
  window.localStorage.removeItem(PHARMACY_SESSION_KEY);
  const client = getPharmacySupabase();
  if (!client) throw new Error("The pharmacy service is unavailable.");
  const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw new Error("The pharmacy session could not be established.");
}

export async function clearPharmacySession(): Promise<void> {
  if (typeof window === "undefined") return;
  const client = getPharmacySupabase();
  if (client) await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  window.sessionStorage.removeItem(PHARMACY_SESSION_KEY);
  window.localStorage.removeItem(PHARMACY_SESSION_KEY);
}

export async function pharmacyAccessToken(): Promise<string | null> {
  const client = getPharmacySupabase();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) {
    await clearPharmacySession();
    return null;
  }
  return data.session?.access_token ?? null;
}

export async function hasStoredPharmacySession(): Promise<boolean> {
  return Boolean(await pharmacyAccessToken());
}

export function getPharmacySupabase(): SupabaseClient | null {
  if (!url || !key) return null;
  return shared.__med250PharmacySupabase ??= createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: PHARMACY_SESSION_KEY,
      storage: pharmacySessionStorage,
    },
  });
}
