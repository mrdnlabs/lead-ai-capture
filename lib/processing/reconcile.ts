import { z } from 'zod';
import type { ProviderCallContext } from '@/lib/providers/types';
import { getExtractionProvider } from '@/lib/providers';
import type { ProviderConfig } from '@/db/schema';

export interface ReconcileInput {
  badgeFields: Record<string, unknown>;
  transcriptFields: Record<string, unknown>;
  /**
   * Values the realtime AI captured via tool calls during the live conversation.
   * The rep verbally confirmed each, so these are treated as high-priority
   * evidence — they often include letter-by-letter-verified spellings.
   */
  liveFields?: Record<string, { value: string; confidence?: number; at: number }>;
  extractionConfig: ProviderConfig;
  credentialApiKey: string;
  captureId: string;
}

export interface ReconcileOutput {
  mergedFields: Record<string, unknown>;
  confidenceScores: Record<string, number>;
  sources: Record<string, string>;
}

function buildReconciliationSchema(keys: string[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of keys) {
    shape[key] = z
      .object({
        value: z
          .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
          .optional(),
        confidence: z.number().min(0).max(1),
        source: z.enum(['badge', 'transcript', 'live', 'both', 'inferred', 'missing']),
      })
      .optional();
  }
  return z.object(shape);
}

const INSTRUCTIONS = `You are reconciling up to three extractions of the same trade-show lead.

INPUT 1 ("badge"): structured fields extracted from a photo of the lead's name badge by a vision model.
INPUT 2 ("transcript"): structured fields extracted from a sales rep's spoken notes about the same lead.
INPUT 3 ("live"): values the realtime voice AI captured DURING the conversation via tool calls. Each has a confidence score the AI assigned. The rep confirmed these out loud — names and emails were typically read back letter-by-letter before being recorded.

For EACH field, return:
- value: the canonical merged value (or null if no source has it)
- confidence: 0.0–1.0
- source: where it came from — "badge" | "transcript" | "live" | "both" | "inferred" | "missing"

PRIORITY RULES:
- "live" with confidence ≥ 0.9 WINS over everything else — those were verbally verified in real time. Treat them as ground truth unless they conflict with the badge AND look like a transcription error.
- "live" with confidence < 0.9 is still strong evidence but defer to badge for printed identity fields if the badge OCR is unambiguous.
- If the transcript spells out a name or email letter-by-letter (e.g. "S-A-R-A-H" or "j-doe at acme"), that WINS over badge OCR — badges can be misread.
- For names where the transcript pronounces a name (e.g. "Sarah") but the badge OCR shows a similar string (e.g. "Sara"), prefer the badge if it looks like a complete printed name, otherwise prefer the transcript.
- For email: if badge and transcript differ, prefer the transcript ONLY when spelled letter-by-letter; otherwise the badge wins (printed text is more reliable for emails). Live verified values always beat both.
- For company, title: badge usually wins (printed identity), unless live captured a more specific value the rep confirmed.
- For notes / free-form: prefer the transcript (richer conversation context).
- For qualifying questions (interest_level, decision_maker, etc.): live wins, then transcript.
- Confidence 1.0 = sources agree. 0.8–0.9 = strong evidence one side. 0.5–0.7 = uncertain. < 0.5 = guess.
- If no source has a value, set source="missing" and confidence=0 (omit "value").

Be decisive — do NOT return both alternatives or hedge.`;

export async function reconcileFields(input: ReconcileInput): Promise<ReconcileOutput> {
  const liveFlat: Record<string, unknown> = {};
  if (input.liveFields) {
    for (const [k, v] of Object.entries(input.liveFields)) {
      if (v?.value != null && v.value !== '') liveFlat[k] = v.value;
    }
  }

  const keys = Array.from(
    new Set([
      ...Object.keys(input.badgeFields),
      ...Object.keys(input.transcriptFields),
      ...Object.keys(liveFlat),
    ]),
  );

  // If there's nothing to reconcile, return empty.
  if (keys.length === 0) {
    return { mergedFields: {}, confidenceScores: {}, sources: {} };
  }

  // If only one source has data, skip the LLM call and pass-through.
  const badgeKeys = Object.keys(input.badgeFields).filter((k) => input.badgeFields[k] != null);
  const transcriptKeys = Object.keys(input.transcriptFields).filter(
    (k) => input.transcriptFields[k] != null,
  );
  const liveKeys = Object.keys(liveFlat);
  const sourcesPresent = [badgeKeys.length > 0, transcriptKeys.length > 0, liveKeys.length > 0]
    .filter(Boolean).length;
  if (sourcesPresent === 1) {
    if (liveKeys.length > 0) return passThroughLive(input.liveFields ?? {});
    if (badgeKeys.length > 0) return passThrough(input.badgeFields, 'badge');
    if (transcriptKeys.length > 0) return passThrough(input.transcriptFields, 'transcript');
  }

  const schema = buildReconciliationSchema(keys);
  const provider = getExtractionProvider(input.extractionConfig);
  const ctx: ProviderCallContext = {
    config: input.extractionConfig,
    credential: {
      id: input.extractionConfig.credentialId,
      provider: input.extractionConfig.provider,
      apiKey: input.credentialApiKey,
    },
    captureId: input.captureId,
  };

  const prompt = `BADGE: ${JSON.stringify(input.badgeFields, null, 2)}

TRANSCRIPT: ${JSON.stringify(input.transcriptFields, null, 2)}

LIVE (verbally confirmed during the conversation, with the AI's per-field confidence):
${JSON.stringify(input.liveFields ?? {}, null, 2)}`;

  try {
    const result = await provider.extractFromText({
      ctx,
      text: prompt,
      schema,
      instructions: INSTRUCTIONS,
    });
    const object = result.fields as Record<
      string,
      { value?: unknown; confidence: number; source: string } | undefined
    >;
    const mergedFields: Record<string, unknown> = {};
    const confidenceScores: Record<string, number> = {};
    const sources: Record<string, string> = {};
    for (const key of keys) {
      const entry = object[key];
      if (!entry) continue;
      if (entry.value != null && entry.value !== '') {
        mergedFields[key] = entry.value;
        confidenceScores[key] = entry.confidence;
        sources[key] = entry.source;
      }
    }
    return { mergedFields, confidenceScores, sources };
  } catch (e) {
    console.error('[reconcile] LLM call failed, falling back to rule-based merge:', (e as Error).message);
    // Fallback: simple precedence — live > badge for identity, transcript for notes.
    return fallbackMerge(input.badgeFields, input.transcriptFields, input.liveFields);
  }
}

function passThroughLive(
  fields: Record<string, { value: string; confidence?: number; at: number }>,
): ReconcileOutput {
  const merged: Record<string, unknown> = {};
  const conf: Record<string, number> = {};
  const src: Record<string, string> = {};
  for (const [k, entry] of Object.entries(fields)) {
    if (entry.value == null || entry.value === '') continue;
    merged[k] = entry.value;
    conf[k] = entry.confidence ?? 0.9;
    src[k] = 'live';
  }
  return { mergedFields: merged, confidenceScores: conf, sources: src };
}

function passThrough(fields: Record<string, unknown>, source: string): ReconcileOutput {
  const merged: Record<string, unknown> = {};
  const conf: Record<string, number> = {};
  const src: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '') continue;
    merged[k] = v;
    conf[k] = 0.85;
    src[k] = source;
  }
  return { mergedFields: merged, confidenceScores: conf, sources: src };
}

const BADGE_PREFERRED = new Set(['name', 'email', 'company', 'title', 'first_name', 'last_name']);

function fallbackMerge(
  badge: Record<string, unknown>,
  transcript: Record<string, unknown>,
  live?: Record<string, { value: string; confidence?: number; at: number }>,
): ReconcileOutput {
  const merged: Record<string, unknown> = {};
  const conf: Record<string, number> = {};
  const src: Record<string, string> = {};
  const keys = new Set([
    ...Object.keys(badge),
    ...Object.keys(transcript),
    ...(live ? Object.keys(live) : []),
  ]);
  for (const key of keys) {
    const b = badge[key];
    const t = transcript[key];
    const l = live?.[key];
    // Live with high confidence wins outright (rep verbally confirmed)
    if (l && l.value && (l.confidence ?? 0.9) >= 0.9) {
      merged[key] = l.value;
      conf[key] = l.confidence ?? 0.9;
      src[key] = 'live';
      continue;
    }
    if (b != null && b !== '' && (BADGE_PREFERRED.has(key) || t == null || t === '')) {
      merged[key] = b;
      conf[key] = t != null && t !== '' ? 0.7 : 0.6;
      src[key] = 'badge';
    } else if (t != null && t !== '') {
      merged[key] = t;
      conf[key] = b != null && b !== '' ? 0.7 : 0.6;
      src[key] = 'transcript';
    } else if (l && l.value) {
      // Lower-confidence live still beats nothing
      merged[key] = l.value;
      conf[key] = l.confidence ?? 0.7;
      src[key] = 'live';
    }
  }
  return { mergedFields: merged, confidenceScores: conf, sources: src };
}
