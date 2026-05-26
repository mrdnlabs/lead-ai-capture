import { createBrowserClient } from '@supabase/ssr';

// Next.js replaces NEXT_PUBLIC_* env vars at build time with literal strings.
// Must reference each name literally (no computed keys) for that replacement.
function getPublicEnv(): { url: string; anonKey: string } {
  const url =
    process.env.NEXT_PUBLIC_aicapture_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_aicapture_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC Supabase env vars are missing — check .env.local');
  }
  return { url, anonKey };
}

export function createSupabaseBrowserClient() {
  const { url, anonKey } = getPublicEnv();
  return createBrowserClient(url, anonKey);
}
