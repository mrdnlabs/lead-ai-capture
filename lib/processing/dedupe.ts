import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { captures, leads, opportunities, type Lead, type ProviderConfig } from '@/db/schema';
import { getExtractionProvider } from '@/lib/providers';
import type { ProviderCallContext } from '@/lib/providers/types';

const dedupeSchema = z.object({
  match: z.boolean().describe('True if the new lead matches one of the candidates.'),
  matchedOpportunityId: z
    .string()
    .nullable()
    .describe('UUID of the matching opportunity, or null if no match.'),
  confidence: z.number().min(0).max(1).describe('How confident: 1.0 = identical person, 0.5 = uncertain.'),
  reasoning: z.string().describe('One-sentence justification.'),
});

const SYSTEM = `You are deduplicating trade-show lead records.
You'll see a NEW lead's fields and a list of EXISTING leads in the same show.
Decide if the new lead is the SAME person as one of the existing ones.

IMPORTANT — both inputs may come from speech-to-text, which mis-transcribes
short proper nouns regularly. "Axis" → "Access", "Cyan" → "Cyon", "Nicholl"
→ "Nickel", etc. Treat both names AND companies as potentially mis-heard.

Match rules:
- Same email or phone (exact) → definite match, regardless of name spelling.
- Same/similar name AND same/similar company → match.
- Same/similar name AND phonetically-similar company → likely match. (e.g.
  "Dave Nicholl at Axis" vs "Dave Nickel at Access" → match — both names
  and the company differ only by transcription errors.)
- Same name AND clearly different company (different industries, no
  phonetic overlap, no shared substring) → NOT a match.
- Different first name → NOT a match (unless one side is clearly incomplete).

Phonetic similarity heuristics — apply to BOTH names and companies:
- Voiced ↔ unvoiced consonants: b↔p, d↔t, g↔k, z↔s, v↔f, j↔ch, x↔ks/cs
- Vowels frequently mis-transcribe: a↔e↔i, o↔u
- Final consonants commonly dropped (-s, -t, -e silent)
- Single-syllable proper nouns are highest-risk for mis-transcription

Confidence:
- 0.95+: explicit identifier match (email/phone) or perfect name+company
- 0.80–0.95: strong name + (exact or phonetic) company similarity
- 0.70–0.80: name match + company close phonetically (typical mis-hear case)
- 0.50–0.70: ambiguous — return match=false to be safe
- < 0.5: clearly different`;

interface DedupeArgs {
  newFields: Record<string, unknown>;
  showId: string;
  excludeOpportunityId: string;
  extractionConfig: ProviderConfig;
  credentialApiKey: string;
  captureId: string;
  /** Match threshold; below this we treat as no match. */
  threshold?: number;
}

export interface DedupeResult {
  matchedOpportunityId: string | null;
  confidence: number;
  reasoning: string;
  candidateCount: number;
}

export async function findDuplicateLead(args: DedupeArgs): Promise<DedupeResult> {
  // 1. Pre-filter: anything with a comparable name/company
  const candidates = await listCandidates(args.showId, args.excludeOpportunityId);
  if (candidates.length === 0) {
    return { matchedOpportunityId: null, confidence: 0, reasoning: 'no existing leads', candidateCount: 0 };
  }

  // 2. Build prompt
  const candidatesPayload = candidates.map((c) => ({
    opportunityId: c.opportunityId,
    fields: pickIdentityFields(c.mergedFields as Record<string, unknown>),
  }));
  const prompt = `NEW lead fields:
${JSON.stringify(pickIdentityFields(args.newFields), null, 2)}

EXISTING leads in this show:
${JSON.stringify(candidatesPayload, null, 2)}`;

  // 3. Ask Gemini
  const provider = getExtractionProvider(args.extractionConfig);
  const ctx: ProviderCallContext = {
    config: args.extractionConfig,
    credential: {
      id: args.extractionConfig.credentialId,
      provider: args.extractionConfig.provider,
      apiKey: args.credentialApiKey,
    },
    captureId: args.captureId,
  };

  try {
    const result = await provider.extractFromText({
      ctx,
      text: prompt,
      schema: dedupeSchema,
      instructions: SYSTEM,
    });
    const out = result.fields as z.infer<typeof dedupeSchema>;
    const threshold = args.threshold ?? 0.75;
    const accepted = out.match && (out.matchedOpportunityId ?? '').length > 0 && out.confidence >= threshold;
    return {
      matchedOpportunityId: accepted ? out.matchedOpportunityId : null,
      confidence: out.confidence,
      reasoning: out.reasoning,
      candidateCount: candidates.length,
    };
  } catch (e) {
    console.error('[dedupe] LLM call failed:', (e as Error).message);
    return { matchedOpportunityId: null, confidence: 0, reasoning: 'LLM error', candidateCount: candidates.length };
  }
}

function pickIdentityFields(fields: Record<string, unknown>): Record<string, unknown> {
  const KEYS = ['name', 'first_name', 'last_name', 'email', 'company', 'title', 'phone'];
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    if (fields[k] != null && fields[k] !== '') out[k] = fields[k];
  }
  return out;
}

interface Candidate {
  opportunityId: string;
  mergedFields: unknown;
}

async function listCandidates(showId: string, exclude: string): Promise<Candidate[]> {
  const rows = await db
    .select({ lead: leads, opportunity: opportunities })
    .from(leads)
    .innerJoin(opportunities, eq(opportunities.id, leads.opportunityId))
    .where(eq(opportunities.showId, showId))
    .orderBy(desc(leads.lastUpdatedAt))
    .limit(50);
  return rows
    .filter(({ opportunity }) => opportunity.id !== exclude)
    .map(({ lead }) => ({ opportunityId: lead.opportunityId, mergedFields: lead.mergedFields }));
}

/**
 * Re-point a capture's placeholder opportunity to a matched existing one,
 * delete the placeholder, and merge fields into the existing lead.
 */
export async function mergeIntoExistingOpportunity(args: {
  captureId: string;
  fromOpportunityId: string;
  toOpportunityId: string;
  newFields: Record<string, unknown>;
  newConfidence: Record<string, number>;
  photoBlobKey: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(captures)
      .set({ opportunityId: args.toOpportunityId })
      .where(eq(captures.id, args.captureId));

    const [existing] = await tx
      .select()
      .from(leads)
      .where(eq(leads.opportunityId, args.toOpportunityId))
      .limit(1);

    if (existing) {
      const merged: Record<string, unknown> = { ...existing.mergedFields };
      const conf: Record<string, number> = { ...existing.confidenceScores };
      for (const [k, v] of Object.entries(args.newFields)) {
        const oldConf = conf[k] ?? 0;
        const newConf = args.newConfidence[k] ?? 0.5;
        // Prefer the higher-confidence value
        if (newConf > oldConf || merged[k] == null) {
          merged[k] = v;
          conf[k] = newConf;
        }
      }
      const processedIds = existing.processedCaptureIds.includes(args.captureId)
        ? existing.processedCaptureIds
        : [...existing.processedCaptureIds, args.captureId];
      await tx
        .update(leads)
        .set({
          mergedFields: merged,
          confidenceScores: conf,
          processedCaptureIds: processedIds,
          badgePhotoBlobKey: existing.badgePhotoBlobKey ?? args.photoBlobKey,
          lastUpdatedAt: new Date(),
        })
        .where(eq(leads.opportunityId, args.toOpportunityId));
    }

    // Delete the placeholder opportunity (cascade should clear any orphaned lead row).
    await tx.delete(opportunities).where(eq(opportunities.id, args.fromOpportunityId));
  });
}

export type { Lead };
