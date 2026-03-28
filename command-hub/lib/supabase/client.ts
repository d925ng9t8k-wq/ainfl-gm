import { createBrowserClient } from "@supabase/ssr";

// Client-side Supabase instance — safe to use in React components.
// Reads public env vars only (NEXT_PUBLIC_*).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
