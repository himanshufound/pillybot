import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabaseConfigError = !supabaseUrl || !supabaseAnonKey
  ? "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY"
  : null;

function ensureSupabaseConfigured() {
  if (supabaseConfigError) {
    throw new Error(supabaseConfigError);
  }
}

export function getSupabaseConfigError() {
  return supabaseConfigError;
}

export const supabase = createClient(
  supabaseUrl ?? "https://invalid.localhost",
  supabaseAnonKey ?? "invalid-anon-key",
  {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
    storageKey: "pillybot-session",
  },
},
);

export async function getSession() {
  ensureSupabaseConfigured();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function getCurrentUser() {
  ensureSupabaseConfigured();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw error;
  }
  return data.user;
}

export async function signInWithPassword(email: string, password: string) {
  ensureSupabaseConfigured();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signInWithMagicLink(email: string) {
  ensureSupabaseConfigured();
  // The app uses HashRouter, so the post-auth landing route lives after
  // the URL fragment. Supabase will append session tokens to whatever we
  // give here; pointing at /#/ keeps the tokens inside the fragment so
  // they don't leak into server logs and `detectSessionInUrl` still picks
  // them up.
  return supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/#/`,
    },
  });
}

export async function signOut() {
  ensureSupabaseConfigured();
  return supabase.auth.signOut();
}
