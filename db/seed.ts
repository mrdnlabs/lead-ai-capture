import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { opportunities, reps, shows, showReps } from './schema';

async function main() {
  const url =
    process.env.aicapture_POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING required for seeding');

  const sql = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(sql);

  try {
    // 1. Demo show
    let [show] = await db.select().from(shows).where(eq(shows.slug, 'demo')).limit(1);
    if (!show) {
      [show] = await db
        .insert(shows)
        .values({
          name: 'Demo Show',
          slug: 'demo',
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        })
        .returning();
      console.log('Created show:', show.name, '(' + show.slug + ')');
    } else {
      console.log('Show exists:', show.name);
    }

    // 2. Link every rep to the show
    const allReps = await db.select().from(reps);
    for (const rep of allReps) {
      await db
        .insert(showReps)
        .values({ showId: show.id, repId: rep.id, role: rep.role === 'admin' ? 'admin' : 'rep' })
        .onConflictDoNothing();
    }
    console.log(`Linked ${allReps.length} rep(s) to show.`);

    // 3. Default opportunity
    const [opp] = await db
      .insert(opportunities)
      .values({ showId: show.id, code: 'DEMO01', status: 'open' })
      .onConflictDoNothing()
      .returning();
    if (opp) console.log('Created opportunity:', opp.code);
    else console.log('Opportunity DEMO01 already exists.');

    console.log('\nSeed complete. Try:');
    console.log('  - /s/demo/capture  (rep view)');
    console.log('  - /s/demo/leads    (display mode)');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Seed FAILED:', e);
    process.exit(1);
  });
