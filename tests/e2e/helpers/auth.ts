import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Generate a magic-link token via the Supabase admin API and consume it in
 * the browser context — leaves the page signed in.
 */
export async function signInAs(context: BrowserContext, email: string, nextPath = '/') {
  const url = process.env.NEXT_PUBLIC_aicapture_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.aicapture_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase env vars missing for test sign-in');
  }
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error('No hashed_token from admin generateLink');

  const baseURL = (context as unknown as { _options?: { baseURL?: string } })._options?.baseURL;
  const origin = baseURL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  const page: Page = await context.newPage();
  await page.goto(
    `${origin}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink&next=${encodeURIComponent(nextPath)}`,
  );
  await page.waitForURL((u) => !u.toString().includes('/auth/callback'), { timeout: 10_000 });
  return page;
}
