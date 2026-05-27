import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { desc } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as s from '@/db/schema';

async function main() {
  const sql = postgres(process.env.aicapture_POSTGRES_URL_NON_POOLING!, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema: s });
  const rows = await db
    .select({
      id: s.captures.id,
      audio: s.captures.audioBlobKey,
      photo: s.captures.photoBlobKey,
      hadAssist: s.captures.hadRealtimeAssist,
      transcript: s.captures.realtimeTranscript,
      status: s.captures.status,
      at: s.captures.serverReceivedAt,
    })
    .from(s.captures)
    .orderBy(desc(s.captures.serverReceivedAt))
    .limit(5);
  for (const r of rows) {
    const turns = Array.isArray(r.transcript) ? r.transcript.length : 0;
    console.log(
      r.id.slice(0, 8),
      '| audio:', r.audio ? 'YES' : 'no',
      '| photo:', r.photo ? 'YES' : 'no',
      '| assist:', r.hadAssist,
      '| transcript turns:', turns,
      '| status:', r.status,
      '|', new Date(r.at).toLocaleString(),
    );
    if (turns > 0 && Array.isArray(r.transcript)) {
      for (const t of (r.transcript as Array<{ role: string; text: string }>).slice(0, 4)) {
        console.log('  ', t.role + ':', t.text.slice(0, 80));
      }
    }
  }
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
