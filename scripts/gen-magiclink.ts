// Generate a magic-link URL for a given email using service-role auth.
// Bypasses SMTP + rate limits. Strictly for local dev/testing.
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';

async function main() {
  const email = process.argv[2];
  const next = process.argv[3] ?? '/';
  if (!email) {
    console.error('Usage: pnpm tsx scripts/gen-magiclink.ts <email> [next-path]');
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_aicapture_SUPABASE_URL;
  const serviceKey = process.env.aicapture_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Missing Supabase env vars');
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await client.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error) throw error;
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error('No hashed_token in admin response');

  const callbackUrl = `http://localhost:3000/auth/callback?token_hash=${encodeURIComponent(
    tokenHash,
  )}&type=magiclink&next=${encodeURIComponent(next)}`;

  console.log('Navigate here to sign in (sets cookies via our PKCE-compatible callback):');
  console.log(callbackUrl);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
