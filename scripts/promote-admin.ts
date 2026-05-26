// Usage: pnpm tsx scripts/promote-admin.ts <email>
// Promotes the rep row for <email> to role='admin'. Run after the user
// first signs in (which triggers reps row creation via Supabase auth trigger).

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { reps } from '@/db/schema';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: pnpm tsx scripts/promote-admin.ts <email>');
    process.exit(1);
  }
  const url = process.env.aicapture_POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING not set');
  const sql = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(sql);
  try {
    const result = await db
      .update(reps)
      .set({ role: 'admin' })
      .where(eq(reps.email, email))
      .returning({ id: reps.id, email: reps.email, role: reps.role });
    if (result.length === 0) {
      console.error(`No rep row for ${email}. Sign in first so the trigger creates it.`);
      process.exit(1);
    }
    console.log('Promoted to admin:', result[0]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
