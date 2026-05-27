/**
 * Authentication helper for end-to-end test scripts.
 *
 * Mints a Supabase magic-link via the admin API, calls /auth/callback to
 * exchange it for a session, and captures the Set-Cookie headers so the
 * caller can attach them to subsequent fetches. Same path a real user takes
 * — we just bypass the email step.
 *
 * The caller is responsible for ensuring the email belongs to an existing
 * rep (sign in once via the browser to provision the row in `auth.users`
 * before running tests under that email).
 */
import { createClient } from '@supabase/supabase-js';

export interface AuthedSession {
  cookieHeader: string;
  /** Convenience: pass directly into fetch's `headers` object */
  headers: Record<string, string>;
  /** Echo of inputs so tests can log them */
  email: string;
  baseUrl: string;
}

export interface LoginArgs {
  email: string;
  /** Defaults to https://ai-capture.vercel.app — override for local testing. */
  baseUrl?: string;
  supabaseUrl?: string;
  supabaseServiceKey?: string;
}

export async function loginAsTestRep(args: LoginArgs): Promise<AuthedSession> {
  const baseUrl =
    args.baseUrl ??
    process.env.AICAPTURE_TEST_BASE_URL ??
    'https://ai-capture.vercel.app';
  const supabaseUrl =
    args.supabaseUrl ?? process.env.NEXT_PUBLIC_aicapture_SUPABASE_URL;
  const serviceKey =
    args.supabaseServiceKey ?? process.env.aicapture_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'Missing Supabase env vars: NEXT_PUBLIC_aicapture_SUPABASE_URL and aicapture_SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  // 1. Mint a magic-link token via the admin API.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: args.email,
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error('admin.generateLink returned no hashed_token');

  // 2. Hit /auth/callback to exchange the token for a session. The handler
  //    sets sb-... auth cookies via Set-Cookie and redirects to `next`.
  //    We use redirect: 'manual' so we can capture cookies on the 302 itself.
  const callbackUrl = `${baseUrl}/auth/callback?token_hash=${encodeURIComponent(
    tokenHash,
  )}&type=magiclink&next=/`;
  const res = await fetch(callbackUrl, { redirect: 'manual' });
  // Either 302 (success → redirect to /) or some other status on failure.
  if (res.status >= 400) {
    throw new Error(`/auth/callback returned ${res.status}: ${await res.text()}`);
  }
  const setCookies = res.headers.getSetCookie();
  if (setCookies.length === 0) {
    throw new Error(
      `/auth/callback set no cookies — status was ${res.status}. Check that ${args.email} exists in auth.users.`,
    );
  }

  // 3. Collapse Set-Cookie list into a single Cookie header. Strip attributes
  //    like Path, Max-Age, etc. — only name=value matters for outgoing requests.
  const cookieHeader = setCookies
    .map((c) => c.split(';')[0])
    .filter((c) => c.includes('='))
    .join('; ');

  return {
    cookieHeader,
    headers: { Cookie: cookieHeader },
    email: args.email,
    baseUrl,
  };
}
