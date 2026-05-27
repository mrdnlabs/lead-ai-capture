// Measure the actual byte/token footprint of the dedupe prompt at various
// candidate-set sizes.
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { desc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

// Approximate Gemini token count: SentencePiece tokenization runs ~3.7
// chars/token for English-heavy JSON (slightly less for pure data, slightly
// more for free-form text). We use 3.7 as a calibrated middle.
const CHARS_PER_TOKEN = 3.7;

const SYSTEM_INSTRUCTIONS = `You are deduplicating trade-show lead records.
You'll see a NEW lead's fields and a list of EXISTING leads in the same show.
Decide if the new lead is the SAME person as one of the existing ones.

Match rules:
- Same name (allowing minor spelling variation, nicknames) AND same company → almost certainly a match.
- Same email or phone (exact) → definite match, regardless of name spelling.
- Similar name but different company → NOT a match (probably different people with similar names).
- Different first name → NOT a match (unless the existing lead has a clearly incomplete name).

Confidence:
- 0.95+: explicit identifier match (email/phone) or perfect name+company
- 0.7–0.95: strong name + company similarity
- 0.5–0.7: ambiguous — return match=false to be safe
- < 0.5: clearly different`;

function pickIdentityFields(fields: Record<string, unknown>): Record<string, unknown> {
  const KEYS = ['name', 'first_name', 'last_name', 'email', 'company', 'title', 'phone'];
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    if (fields[k] != null && fields[k] !== '') out[k] = fields[k];
  }
  return out;
}

async function main() {
  const url = process.env.aicapture_POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING required');
  const sql = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });

  try {
    // Fetch existing leads as the seed of our synthetic candidate set
    const realLeads = await db
      .select({ lead: schema.leads, opportunity: schema.opportunities })
      .from(schema.leads)
      .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.leads.opportunityId))
      .orderBy(desc(schema.leads.lastUpdatedAt))
      .limit(10);

    if (realLeads.length === 0) {
      console.log('No leads in DB yet — synthesizing a representative sample.');
    }

    // Build a synthetic 500-lead candidate set by varying a template
    const template = realLeads[0]?.lead.mergedFields as Record<string, unknown> | undefined;
    const baseFields = template ?? {
      name: 'Jane Doe',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane.doe@acmerobotics.io',
      company: 'Acme Robotics',
      title: 'VP of Engineering',
      phone: '+1 (415) 555-0182',
    };

    function makeCandidate(i: number) {
      const firstNames = ['Sarah', 'James', 'Aisha', 'Marcus', 'Priya', 'Liam', 'Yuki', 'Carlos', 'Fatima', 'David'];
      const lastNames = ['Chen', 'Patel', 'Rodriguez', 'Müller', 'Singh', 'Kim', 'Okonkwo', 'Lopez', 'Nakamura', 'Brown'];
      const companies = ['Acme Robotics', 'Northwind Software', 'Globex Health', 'Initech', 'Soylent Foods', 'Hooli AI', 'Massive Dynamic', 'Stark Industries', 'Wayne Enterprises', 'Tyrell Corp'];
      const titles = ['VP Engineering', 'CTO', 'Product Manager', 'Solutions Architect', 'Director of IT', 'Head of Procurement', 'Operations Manager', 'CEO', 'Sales Director', 'Lead Buyer'];
      const fn = firstNames[i % firstNames.length];
      const ln = lastNames[(i * 7) % lastNames.length];
      const co = companies[(i * 11) % companies.length];
      const ti = titles[(i * 13) % titles.length];
      return {
        opportunityId: '7e0c1a27-fa4b-4226-8727-' + String(i).padStart(12, '0'),
        fields: pickIdentityFields({
          ...baseFields,
          name: `${fn} ${ln}`,
          first_name: fn,
          last_name: ln,
          email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${co.toLowerCase().replace(/\s+/g, '')}.com`,
          company: co,
          title: ti,
        }),
      };
    }

    const newCaptureFields = pickIdentityFields(baseFields);

    function buildPrompt(numCandidates: number): { prompt: string; chars: number; tokens: number } {
      const candidates = Array.from({ length: numCandidates }, (_, i) => makeCandidate(i));
      const prompt = `BADGE: ${JSON.stringify(newCaptureFields, null, 2)}

EXISTING leads in this show:
${JSON.stringify(candidates, null, 2)}`;
      const fullInput = `${SYSTEM_INSTRUCTIONS}\n\n---\nTranscript:\n${prompt}`;
      const chars = fullInput.length;
      const tokens = Math.round(chars / CHARS_PER_TOKEN);
      return { prompt: fullInput, chars, tokens };
    }

    // Measure one candidate in detail
    const oneCandidate = makeCandidate(0);
    const oneJson = JSON.stringify(oneCandidate, null, 2);
    console.log('=== Per-candidate footprint ===');
    console.log(`Sample candidate JSON:\n${oneJson}`);
    console.log(`Chars per candidate (incl JSON formatting): ${oneJson.length}`);
    console.log(`Estimated tokens per candidate: ${Math.round(oneJson.length / CHARS_PER_TOKEN)}`);
    console.log('');

    // Fixed overhead (system + new fields + schema description)
    const fixedOverhead = SYSTEM_INSTRUCTIONS.length + JSON.stringify(newCaptureFields, null, 2).length + 200; // ~200 for prompt scaffolding
    console.log(`Fixed overhead (system + new fields + scaffold): ~${fixedOverhead} chars / ~${Math.round(fixedOverhead / CHARS_PER_TOKEN)} tokens`);
    console.log('');

    // Gemini 2.5 Flash pricing (per 1M tokens, May 2026)
    const INPUT_PRICE = 0.075; // USD per 1M input tokens
    const OUTPUT_PRICE = 0.30;

    console.log('=== Scaling: input size + cost per dedupe call ===');
    console.log('candidates | chars       | tokens     | cost($)  | latency (est)');
    console.log('-----------+-------------+------------+----------+--------------');
    for (const n of [20, 50, 100, 200, 500, 1000]) {
      const { chars, tokens } = buildPrompt(n);
      const inputCost = (tokens / 1_000_000) * INPUT_PRICE;
      const outputCost = (60 / 1_000_000) * OUTPUT_PRICE; // ~60 output tokens (small structured response)
      const totalCost = inputCost + outputCost;
      const latencyEst = tokens < 3000 ? '~1s' : tokens < 10_000 ? '~2-3s' : tokens < 50_000 ? '~5-10s' : '~15-30s';
      console.log(
        `${String(n).padStart(10)} | ${String(chars).padStart(11)} | ${String(tokens).padStart(10)} | $${totalCost.toFixed(5)} | ${latencyEst}`,
      );
    }
    console.log('');
    console.log(`Gemini 2.5 Flash context window: 1,000,000 tokens — 500 leads = ${Math.round((buildPrompt(500).tokens / 1_000_000) * 100)}% of window.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
