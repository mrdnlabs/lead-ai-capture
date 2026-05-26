import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

async function main() {
  const url = process.env.aicapture_POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING not set');
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    const setupSql = readFileSync(resolve('db/supabase/setup.sql'), 'utf8');
    await sql.unsafe(setupSql);
    console.log('Supabase setup applied successfully');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  if ('detail' in e) console.error('detail:', e.detail);
  process.exit(1);
});
