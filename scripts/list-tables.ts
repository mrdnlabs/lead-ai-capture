import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import postgres from 'postgres';

async function main() {
  const url = process.env.aicapture_POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING not set');
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`;
    console.log(`Tables in public schema (${tables.length}):`);
    for (const t of tables) console.log(' -', t.table_name);

    const fks = await sql<{ constraint_name: string; table_name: string }[]>`
      SELECT constraint_name, table_name
      FROM information_schema.table_constraints
      WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'
        AND constraint_name LIKE 'reps_%'`;
    console.log(`\nreps FKs (${fks.length}):`);
    for (const f of fks) console.log(' -', f.constraint_name, 'on', f.table_name);

    const triggers = await sql<{ trigger_name: string; event_object_schema: string; event_object_table: string }[]>`
      SELECT trigger_name, event_object_schema, event_object_table
      FROM information_schema.triggers
      WHERE trigger_name = 'on_auth_user_created'`;
    console.log(`\nauth triggers (${triggers.length}):`);
    for (const t of triggers) console.log(' -', t.trigger_name, 'on', t.event_object_schema + '.' + t.event_object_table);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
