/**
 * Centralized, validated access to Supabase environment variables.
 *
 * Security notes:
 * - `NEXT_PUBLIC_*` values are exposed to the browser by design. The Supabase
 *   anon key is safe to expose because Row Level Security (RLS) protects data.
 * - `SUPABASE_SERVICE_ROLE_KEY` is SERVER-ONLY. It must never be imported into
 *   client code and must never be prefixed with `NEXT_PUBLIC_`.
 */

function requireEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.local.example to .env.local and fill in your Supabase values.`
    );
  }
  return value;
}

/** Public Supabase project URL (safe for browser + server). */
export function getSupabaseUrl(): string {
  return requireEnv(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL"
  );
}

/** Public Supabase anon key (safe for browser + server; protected by RLS). */
export function getSupabaseAnonKey(): string {
  return requireEnv(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );
}

/**
 * Server-only Supabase service role key.
 * Throws if called in a browser context to prevent accidental leakage.
 */
export function getSupabaseServiceRoleKey(): string {
  if (typeof window !== "undefined") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must never be accessed in the browser."
    );
  }
  return requireEnv(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY"
  );
}