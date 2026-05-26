// Add a realtime provider config using the existing Gemini credential.
// Idempotent — won't duplicate if a default realtime config already exists.
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

const { providerConfigs, providerCredentials } = schema;

async function main() {
  const url = process.env.aicapture_POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING required');
  const sql = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });

  try {
    const [cred] = await db
      .select()
      .from(providerCredentials)
      .where(and(eq(providerCredentials.provider, 'gemini'), eq(providerCredentials.isActive, true)))
      .limit(1);
    if (!cred) throw new Error('No active Gemini credential. Add one at /admin/providers first.');

    const [existing] = await db
      .select()
      .from(providerConfigs)
      .where(and(eq(providerConfigs.kind, 'realtime'), eq(providerConfigs.isDefault, true)))
      .limit(1);
    if (existing) {
      console.log('Default realtime config already exists:', existing.id, existing.model);
      return;
    }

    const [row] = await db
      .insert(providerConfigs)
      .values({
        kind: 'realtime',
        provider: 'gemini',
        model: 'gemini-2.5-flash-preview-native-audio-dialog',
        credentialId: cred.id,
        label: 'Gemini Live (native audio dialog)',
        settings: {},
        isDefault: true,
      })
      .returning();
    console.log('Created realtime config:', row.id, '(' + row.model + ')');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
