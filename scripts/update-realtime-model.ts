// Update the existing default realtime config to use the model name that
// actually works (the previewed name we seeded earlier doesn't exist).
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

async function main() {
  const url = process.env.aicapture_POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING required');
  const sql = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });
  try {
    const res = await db
      .update(schema.providerConfigs)
      .set({ model: 'gemini-3.1-flash-live-preview' })
      .where(and(eq(schema.providerConfigs.kind, 'realtime'), eq(schema.providerConfigs.provider, 'gemini')))
      .returning({ id: schema.providerConfigs.id, model: schema.providerConfigs.model });
    console.log('Updated configs:', res);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
