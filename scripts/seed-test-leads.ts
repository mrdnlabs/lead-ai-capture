/**
 * Seed a diverse battery of test leads into the Demo Show.
 *
 * Picks edge cases that exercise the AI matcher:
 *   - phonetic siblings (Dave / David)
 *   - typo-stored vs cleanly-spelled
 *   - hyphenated last names
 *   - same surname different person
 *   - same email domain different person
 *   - similar company names (Acme Robotics / Acme Software)
 *
 * Safe to re-run: skips leads whose opportunityCode already exists.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
const { leads, opportunities, shows, showReps } = schema;

const sql = postgres(
  process.env.aicapture_POSTGRES_URL_NON_POOLING ?? process.env.aicapture_POSTGRES_URL ?? '',
  { prepare: false, max: 1 },
);
const db = drizzle(sql, { schema });

interface Seed {
  code: string;
  fields: Record<string, string>;
  /** Reps already at the show — used as createdByRepId */
  createdByRepId?: string;
}

const SEED_LEADS: Seed[] = [
  // Phonetic-sibling pair: David Chen and Dave Chan at related companies
  {
    code: 'TST001',
    fields: {
      name: 'David Chen',
      email: 'david.chen@acmerobotics.io',
      company: 'Acme Robotics',
      title: 'Director of Engineering',
      phone: '415-555-0199',
    },
  },
  {
    code: 'TST002',
    fields: {
      name: 'Dave Chan',
      email: 'd.chan@acmesoftware.com',
      company: 'Acme Software',
      title: 'Principal Engineer',
      phone: '650-555-0144',
    },
  },
  // Typo'd row — actual lead is "Stephen Tatum" but the badge OCR mis-recognized
  // the last name as "Tatem". Tests whether a corrected pronunciation matches.
  {
    code: 'TST003',
    fields: {
      name: 'Stephen Tatem',
      email: 's.tatum@northwind.co',
      company: 'Northwind Logistics',
      title: 'VP Operations',
      phone: '312-555-0177',
    },
  },
  // Hyphenated last name + non-English first
  {
    code: 'TST004',
    fields: {
      name: 'Priya Iyer-Walsh',
      email: 'priya@helio-cell.com',
      company: 'Helio Cell',
      title: 'Head of Product',
    },
  },
  // Common name, distinct company — should NOT match when a different "John Smith" walks up
  {
    code: 'TST005',
    fields: {
      name: 'John Smith',
      email: 'jsmith@globex.example',
      company: 'Globex',
      title: 'Sales Director',
    },
  },
  // Same email domain as TST001 but a different person — domain alone shouldn't trigger a match
  {
    code: 'TST006',
    fields: {
      name: 'Sarah Okafor',
      email: 'sarah.okafor@acmerobotics.io',
      company: 'Acme Robotics',
      title: 'Engineering Manager',
    },
  },
  // Lead with minimal info (just first name + company) — tests sparse matching
  {
    code: 'TST007',
    fields: {
      name: 'Marcus',
      company: 'BlueRiver Analytics',
    },
  },
  // Long, distinctive name — should be easy to match unambiguously
  {
    code: 'TST008',
    fields: {
      name: 'Yuki Watanabe-Hartmann',
      email: 'yuki.wh@northstar.aero',
      company: 'NorthStar Aerospace',
      title: 'Chief Scientist',
      phone: '+44 20 7946 0958',
    },
  },
  // Pre-existing rep follow-up: same person as a future scenario but at "old" company
  {
    code: 'TST009',
    fields: {
      name: 'Emma Lindqvist',
      email: 'emma.l@orbitlabs.co',
      company: 'Orbit Labs',
      title: 'Senior PM',
    },
  },
];

async function main() {
  const [demoShow] = await db.select().from(shows).where(eq(shows.slug, 'demo')).limit(1);
  if (!demoShow) {
    console.error('Demo show not found. Run scripts/seed-gemini.ts first.');
    process.exit(1);
  }

  // Need a rep to credit as creator. Pull the first member of the show.
  const [member] = await db.select().from(showReps).where(eq(showReps.showId, demoShow.id)).limit(1);
  if (!member) {
    console.error('No reps belong to demo show. Sign in once first.');
    process.exit(1);
  }
  const repId = member.repId;

  let added = 0;
  let skipped = 0;
  for (const seed of SEED_LEADS) {
    const [existing] = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.showId, demoShow.id), eq(opportunities.code, seed.code)))
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }

    const [opp] = await db
      .insert(opportunities)
      .values({
        showId: demoShow.id,
        code: seed.code,
        status: 'open',
        createdByRepId: repId,
      })
      .returning();
    await db.insert(leads).values({
      opportunityId: opp.id,
      mergedFields: seed.fields,
      missingFields: ['notes'],
      confidenceScores: Object.fromEntries(Object.keys(seed.fields).map((k) => [k, 0.95])),
      processedCaptureIds: [],
      lastUpdatedAt: new Date(),
    });
    added++;
    console.log(`  + ${seed.code}: ${seed.fields.name ?? '(unnamed)'}`);
  }

  console.log(`\nDone. Added ${added}, skipped ${skipped} (already existed).`);
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
