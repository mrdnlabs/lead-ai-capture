import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_aicapture_SUPABASE_URL;
  const serviceKey = process.env.aicapture_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Missing Supabase URL or service role key');
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });

  const buckets = [
    { name: 'capture-audio', mimeTypes: ['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg'] },
    { name: 'capture-photos', mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] },
  ];

  for (const b of buckets) {
    const { data: existing } = await client.storage.getBucket(b.name);
    if (existing) {
      console.log(`bucket exists: ${b.name}`);
      continue;
    }
    const { error } = await client.storage.createBucket(b.name, {
      public: false,
      allowedMimeTypes: b.mimeTypes,
      fileSizeLimit: 50 * 1024 * 1024,
    });
    if (error) throw new Error(`failed to create ${b.name}: ${error.message}`);
    console.log(`created bucket: ${b.name}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
