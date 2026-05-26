import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });
import postgres from 'postgres';

async function test(label: string, url: string | undefined) {
  if (!url) {
    console.log(`[${label}] SKIP (no url)`);
    return;
  }
  const u = new URL(url);
  console.log(`[${label}] connecting to ${u.hostname}:${u.port} as ${u.username}...`);
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    const rows = await sql<{ db: string; usr: string }[]>`select current_database() as db, current_user as usr`;
    console.log(`[${label}] OK — db=${rows[0].db} user=${rows[0].usr}`);
  } catch (e) {
    const err = e as Error & { code?: string };
    console.error(`[${label}] FAIL — code=${err.code} msg=${err.message}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  await test('pooled (6543)', process.env.aicapture_POSTGRES_URL);
  await test('direct (5432)', process.env.aicapture_POSTGRES_URL_NON_POOLING);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
