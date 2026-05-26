// Inspect a capture + its extraction + the resulting lead.
// Usage: pnpm tsx scripts/inspect-capture.ts <captureId>
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

async function main() {
  const captureId = process.argv[2];
  if (!captureId) {
    console.error('Usage: pnpm tsx scripts/inspect-capture.ts <captureId>');
    process.exit(1);
  }
  const url = process.env.aicapture_POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING required');
  const sql = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });

  try {
    const [capture] = await db
      .select()
      .from(schema.captures)
      .where(eq(schema.captures.id, captureId))
      .limit(1);
    console.log('\n=== CAPTURE ===');
    console.log(JSON.stringify(capture, null, 2));

    const extractions = await db
      .select()
      .from(schema.captureExtractions)
      .where(eq(schema.captureExtractions.captureId, captureId));
    console.log('\n=== EXTRACTIONS ===');
    console.log(JSON.stringify(extractions, null, 2));

    if (capture) {
      const [lead] = await db
        .select()
        .from(schema.leads)
        .where(eq(schema.leads.opportunityId, capture.opportunityId))
        .limit(1);
      console.log('\n=== LEAD (for opportunity) ===');
      console.log(JSON.stringify(lead, null, 2));
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
