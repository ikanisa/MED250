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
type StoredPharmacySession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
let pharmacyRefresh: Promise<string | null> | null = null;

function readPharmacySession(): StoredPharmacySession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PHARMACY_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const session = parsed as Partial<StoredPharmacySession>;
    if (!session.accessToken || !session.refreshToken || !Number.isFinite(session.expiresAt)) return null;
    return session as StoredPharmacySession;
  } catch {
    return null;
  }
}

export function savePharmacySession(accessToken: string, refreshToken: string, expiresAt?: number): void {
  if (typeof window === "undefined") throw new Error("Pharmacy sign-in requires a browser.");
  if (!accessToken || !refreshToken) throw new Error("The pharmacy session is incomplete.");
  const session: StoredPharmacySession = {
    accessToken,
    refreshToken,
    expiresAt: expiresAt && Number.isFinite(expiresAt) ? expiresAt : Math.floor(Date.now() / 1_000) + 3_600,
  };
  window.localStorage.setItem(PHARMACY_SESSION_KEY, JSON.stringify(session));
}

export function clearPharmacySession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PHARMACY_SESSION_KEY);
}

async function refreshPharmacyAccessToken(session: StoredPharmacySession): Promise<string | null> {
  if (!url || !key) return null;
  try {
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!response.ok) {
      clearPharmacySession();
      return null;
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return null;
    const next = payload as { access_token?: string; refresh_token?: string; expires_at?: number; expires_in?: number };
    if (!next.access_token || !next.refresh_token) return null;
    const expiresAt = next.expires_at
      ?? Math.floor(Date.now() / 1_000) + (Number.isFinite(next.expires_in) ? Number(next.expires_in) : 3_600);
    savePharmacySession(next.access_token, next.refresh_token, expiresAt);
    return next.access_token;
  } catch {
    return session.expiresAt > Math.floor(Date.now() / 1_000) ? session.accessToken : null;
  }
}

export async function pharmacyAccessToken(): Promise<string | null> {
  const session = readPharmacySession();
  if (!session) return null;
  if (session.expiresAt > Math.floor(Date.now() / 1_000) + 60) return session.accessToken;
  pharmacyRefresh ??= refreshPharmacyAccessToken(session).finally(() => { pharmacyRefresh = null; });
  return pharmacyRefresh;
}

export async function hasStoredPharmacySession(): Promise<boolean> {
  return Boolean(await pharmacyAccessToken());
}

export function getPharmacySupabase(): SupabaseClient | null {
  if (!url || !key) return null;
  return shared.__med250PharmacySupabase ??= createClient(url, key, {
    accessToken: async () => await pharmacyAccessToken() ?? key,
  });
}
