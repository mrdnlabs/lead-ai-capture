// Probe correct body shape for v1alpha/auth_tokens.
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { decryptApiKey } from '@/lib/crypto/keyVault';

async function main() {
  const url = process.env.aicapture_POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING required');
  const sql = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });
  const [cred] = await db
    .select()
    .from(schema.providerCredentials)
    .where(eq(schema.providerCredentials.provider, 'gemini'))
    .limit(1);
  await sql.end();
  if (!cred) throw new Error('No Gemini credential');
  const apiKey = decryptApiKey(cred.encryptedApiKey, cred.encryptionKeyId);

  const ep = 'https://generativelanguage.googleapis.com/v1alpha/auth_tokens';

  const bodies = [
    { label: 'flat', body: { uses: 1, expireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString() } },
    { label: 'empty', body: {} },
    {
      label: 'flat with constraints',
      body: {
        uses: 1,
        expireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        liveConnectConstraints: { model: 'models/gemini-2.5-flash-preview-native-audio-dialog' },
      },
    },
  ];

  for (const { label, body } of bodies) {
    const res = await fetch(`${ep}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`\n=== ${label} → ${res.status} ===`);
    console.log(text);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
