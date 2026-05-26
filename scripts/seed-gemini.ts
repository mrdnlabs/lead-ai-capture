// One-shot seed: takes a Gemini API key from env, encrypts via keyVault,
// inserts as provider_credential, then creates 3 provider_configs
// (transcription, vision, extraction) all marked as default.
//
// Usage:
//   $env:GEMINI_KEY = "..."; pnpm tsx scripts/seed-gemini.ts
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { encryptApiKey } from '@/lib/crypto/keyVault';

const { providerConfigs, providerCredentials } = schema;

async function main() {
  const apiKey = process.env.GEMINI_KEY;
  if (!apiKey) {
    console.error('Set GEMINI_KEY env var first.');
    process.exit(1);
  }
  const url = process.env.aicapture_POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING required');
  const sql = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });

  try {
    // 1. Credential
    const enc = encryptApiKey(apiKey);
    const [credential] = await db
      .insert(providerCredentials)
      .values({
        provider: 'gemini',
        label: 'Gemini seeded',
        encryptedApiKey: enc.ciphertext,
        encryptionKeyId: enc.keyId,
        last4: enc.last4,
        isActive: true,
      })
      .returning();
    console.log('Credential:', credential.id, '(…' + credential.last4 + ')');

    // 2. Three configs, all gemini-2.5-flash, all default
    const kinds = ['transcription', 'vision', 'extraction'] as const;
    for (const kind of kinds) {
      // Un-default any existing config of this kind first
      await db
        .update(providerConfigs)
        .set({ isDefault: false })
        .where(and(eq(providerConfigs.kind, kind), eq(providerConfigs.isDefault, true)));
      const [row] = await db
        .insert(providerConfigs)
        .values({
          kind,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          credentialId: credential.id,
          label: `Gemini default (${kind})`,
          settings: {},
          isDefault: true,
        })
        .returning();
      console.log('Config:', kind, '→', row.id);
    }

    console.log('\nDone. Captures will now process via Gemini.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
