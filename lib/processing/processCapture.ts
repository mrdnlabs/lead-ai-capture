import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  captureExtractions,
  captures,
  customFieldDefinitions,
  leads,
  opportunities,
  shows,
} from '@/db/schema';
import { buildLeadSchema } from '@/lib/ai/schemaBuilder';
import {
  getExtractionProvider,
  getTranscriptionProvider,
  getVisionProvider,
} from '@/lib/providers';
import { loadCredential } from '@/lib/providers/credentials';
import {
  resolveProviderConfig,
  resolveShadowProviderConfig,
} from '@/lib/providers/registry';
import { resolveProviderForKind } from '@/lib/providers/resolve';
import { findDuplicateLead, mergeIntoExistingOpportunity } from './dedupe';
import { reconcileFields } from './reconcile';
import { AUDIO_BUCKET, PHOTO_BUCKET, downloadBlob } from '@/lib/storage/server';
import type { ProviderConfig } from '@/db/schema';

interface ProcessOptions {
  captureId: string;
}

interface FieldMerge {
  /** badge vision wins for fields commonly printed on badges. */
  source: 'badge' | 'transcript';
  value: unknown;
}

// Fields a badge image usually has authoritatively.
const BADGE_AUTHORITATIVE = new Set(['name', 'company', 'title', 'email']);

function preferValue(
  existing: { value: unknown; source: FieldMerge['source'] } | undefined,
  candidate: FieldMerge,
  fieldKey: string,
): FieldMerge {
  if (!existing) return candidate;
  if (BADGE_AUTHORITATIVE.has(fieldKey)) {
    if (candidate.source === 'badge') return candidate;
    return existing as FieldMerge;
  }
  // Non-badge fields: prefer transcript (more conversational context).
  if (candidate.source === 'transcript') return candidate;
  return existing as FieldMerge;
}

function mergeFields(
  badgeFields: Record<string, unknown>,
  transcriptFields: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, FieldMerge> = {};
  for (const [key, value] of Object.entries(badgeFields)) {
    if (value == null || value === '') continue;
    merged[key] = preferValue(merged[key], { source: 'badge', value }, key);
  }
  for (const [key, value] of Object.entries(transcriptFields)) {
    if (value == null || value === '') continue;
    merged[key] = preferValue(merged[key], { source: 'transcript', value }, key);
  }
  const out: Record<string, unknown> = {};
  for (const [key, { value }] of Object.entries(merged)) {
    out[key] = value;
  }
  return out;
}

function computeMissingFields(
  merged: Record<string, unknown>,
  required: string[],
): string[] {
  return required.filter((k) => {
    const v = merged[k];
    return v == null || v === '' || (Array.isArray(v) && v.length === 0);
  });
}

const DEFAULT_REQUIRED = ['name', 'company']; // sensible defaults if no custom required fields

export async function processCapture({ captureId }: ProcessOptions): Promise<void> {
  // 1. Load capture + related show
  const [capture] = await db.select().from(captures).where(eq(captures.id, captureId)).limit(1);
  if (!capture) {
    console.warn(`[processCapture] capture ${captureId} not found`);
    return;
  }
  if (capture.status === 'processed') return;

  const [show] = await db.select().from(shows).where(eq(shows.id, capture.showId)).limit(1);
  if (!show) {
    console.warn(`[processCapture] show ${capture.showId} not found`);
    // Mark as failed so it doesn't linger in `queued`/`uploaded` forever.
    await db.update(captures).set({ status: 'failed' }).where(eq(captures.id, captureId));
    return;
  }

  await db.update(captures).set({ status: 'processing' }).where(eq(captures.id, captureId));

  // Wrap the rest in try/finally so the row always lands at processed OR
  // failed — never stuck in `processing` because of a mid-pipeline throw.
  try {
    await runPipeline(capture, show, captureId);
    await db.update(captures).set({ status: 'processed' }).where(eq(captures.id, captureId));
  } catch (e) {
    console.error(`[processCapture] capture ${captureId} failed mid-pipeline:`, (e as Error).message);
    try {
      await db.update(captures).set({ status: 'failed' }).where(eq(captures.id, captureId));
    } catch (markErr) {
      console.error(`[processCapture] failed to mark capture as failed:`, (markErr as Error).message);
    }
    // Re-throw so the caller (api/captures route's after()) sees the failure
    throw e;
  }
}

/**
 * The original processCapture body — extracted so we can wrap it in a
 * try/finally that guarantees a terminal status transition.
 */
async function runPipeline(
  capture: typeof captures.$inferSelect,
  show: typeof shows.$inferSelect,
  captureId: string,
): Promise<void> {

  // 2. Load lead form custom fields (or empty if none configured yet)
  const customFields = show.leadFormId
    ? await db
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.leadFormId, show.leadFormId))
    : [];
  const leadSchema = buildLeadSchema(customFields);
  const requiredFields = [
    ...DEFAULT_REQUIRED,
    ...customFields.filter((f) => f.required).map((f) => f.key),
  ];

  // 3. Resolve providers (user config first, then server env fallback)
  const [transcriptionResolved, visionResolved, extractionResolved] = await Promise.all([
    resolveProviderForKind({
      showId: show.id,
      kind: 'transcription',
      overrideConfigId: show.transcriptionProviderConfigId,
      purpose: 'transcription',
      contextId: captureId,
    }),
    resolveProviderForKind({
      showId: show.id,
      kind: 'vision',
      overrideConfigId: show.visionProviderConfigId,
      purpose: 'vision',
      contextId: captureId,
    }),
    resolveProviderForKind({
      showId: show.id,
      kind: 'extraction',
      overrideConfigId: show.extractionProviderConfigId,
      purpose: 'extraction',
      contextId: captureId,
    }),
  ]);
  const transcriptionConfig = transcriptionResolved?.config ?? null;
  const visionConfig = visionResolved?.config ?? null;
  const extractionConfig = extractionResolved?.config ?? null;

  // 4. Transcribe — prefer the live-conversation transcript captured during
  // realtime assist (richer signal: both speakers, no re-transcription cost
  // or latency). Fall back to batch transcription of the raw audio otherwise.
  let transcript = '';
  let transcriptLatencyMs: number | undefined;
  let transcriptCost: number | undefined;
  let transcriptionModelVersion: string | undefined;
  if (Array.isArray(capture.realtimeTranscript) && capture.realtimeTranscript.length > 0) {
    transcript = (capture.realtimeTranscript as Array<{ role: string; text: string }>)
      .map((t) => `${t.role === 'assistant' ? 'AI' : 'Rep'}: ${t.text}`)
      .join('\n');
    transcriptionModelVersion = 'realtime-live';
  } else if (capture.audioBlobKey && transcriptionResolved) {
    try {
      const audio = await downloadBlob({ bucket: AUDIO_BUCKET, key: capture.audioBlobKey });
      const provider = getTranscriptionProvider(transcriptionResolved.config);
      const result = await provider.transcribe({
        ctx: {
          config: transcriptionResolved.config,
          credential: transcriptionResolved.credential,
          captureId,
        },
        audio: audio.buffer,
        mimeType: audio.mimeType,
      });
      transcript = result.transcript;
      transcriptLatencyMs = result.latencyMs;
      transcriptCost = result.costEstimateUsd;
      transcriptionModelVersion = result.modelVersion;
    } catch (e) {
      console.error('[processCapture] transcription failed:', (e as Error).message);
    }
  }

  // 5. Vision-extract (if photo + vision provider)
  let badgeFields: Record<string, unknown> = {};
  let visionLatencyMs: number | undefined;
  let visionModelVersion: string | undefined;
  if (capture.photoBlobKey && visionResolved) {
    try {
      const photo = await downloadBlob({ bucket: PHOTO_BUCKET, key: capture.photoBlobKey });
      const provider = getVisionProvider(visionResolved.config);
      const instructions =
        visionResolved.config.defaultInstructions ||
        'You are looking at a photo of a person\'s trade-show name badge. Extract the visible fields. If a field is not visible or unreadable, leave it out — do not guess.';
      const result = await provider.extractFromImage({
        ctx: {
          config: visionResolved.config,
          credential: visionResolved.credential,
          captureId,
        },
        image: photo.buffer,
        mimeType: photo.mimeType,
        schema: leadSchema,
        instructions,
      });
      badgeFields = result.fields as Record<string, unknown>;
      visionLatencyMs = result.latencyMs;
      visionModelVersion = result.modelVersion;
    } catch (e) {
      console.error('[processCapture] vision failed:', (e as Error).message);
    }
  }

  // 6. Extract from transcript (if transcript + extraction provider)
  let transcriptFields: Record<string, unknown> = {};
  let extractionLatencyMs: number | undefined;
  let extractionModelVersion: string | undefined;
  if (transcript && extractionResolved) {
    try {
      const provider = getExtractionProvider(extractionResolved.config);
      const instructions =
        extractionResolved.config.defaultInstructions ||
        'Extract lead information from this trade-show conversation transcript. The rep is talking about a lead they met. Extract only what the rep actually said or implied — do not invent facts.';
      const result = await provider.extractFromText({
        ctx: {
          config: extractionResolved.config,
          credential: extractionResolved.credential,
          captureId,
        },
        text: transcript,
        schema: leadSchema,
        instructions,
      });
      transcriptFields = result.fields as Record<string, unknown>;
      extractionLatencyMs = result.latencyMs;
      extractionModelVersion = result.modelVersion;
    } catch (e) {
      console.error('[processCapture] extraction failed:', (e as Error).message);
    }
  }

  // 7. Reconcile badge + transcript + live fields via LLM (with rule-based fallback inside reconcileFields)
  const liveFields =
    capture.liveFields && typeof capture.liveFields === 'object'
      ? (capture.liveFields as Record<string, { value: string; confidence?: number; at: number }>)
      : undefined;
  let mergedNew: Record<string, unknown> = {};
  let confidenceScores: Record<string, number> = {};
  if (
    extractionResolved &&
    (Object.keys(badgeFields).length > 0 ||
      Object.keys(transcriptFields).length > 0 ||
      (liveFields && Object.keys(liveFields).length > 0))
  ) {
    try {
      const reconciled = await reconcileFields({
        badgeFields,
        transcriptFields,
        liveFields,
        extractionConfig: extractionResolved.config,
        credentialApiKey: extractionResolved.credential.apiKey,
        captureId,
      });
      mergedNew = reconciled.mergedFields;
      confidenceScores = reconciled.confidenceScores;
    } catch (e) {
      console.error('[processCapture] reconcile failed; basic merge:', (e as Error).message);
      mergedNew = mergeFields(badgeFields, transcriptFields);
    }
  } else {
    mergedNew = mergeFields(badgeFields, transcriptFields);
  }

  // 7a. Always record the extraction (separate from lead merge so dedupe re-pointing is clean)
  await db.insert(captureExtractions).values({
    captureId,
    transcriptionProviderConfigId: transcriptionConfig?.id ?? null,
    transcript: transcript || null,
    extractedFields: transcriptFields,
    badgeFields,
    modelVersions: {
      ...(transcriptionModelVersion && { transcription: transcriptionModelVersion }),
      ...(visionModelVersion && { vision: visionModelVersion }),
      ...(extractionModelVersion && { extraction: extractionModelVersion }),
    },
    latencyMs: {
      ...(transcriptLatencyMs && { transcription: transcriptLatencyMs }),
      ...(visionLatencyMs && { vision: visionLatencyMs }),
      ...(extractionLatencyMs && { extraction: extractionLatencyMs }),
    },
    costEstimateUsd: transcriptCost?.toString() ?? null,
  });

  // 7b. AI dedupe — does this match an existing lead in the show?
  let dedupeApplied = false;
  if (extractionResolved && Object.keys(mergedNew).length > 0) {
    try {
      const dedupeResult = await findDuplicateLead({
        newFields: mergedNew,
        showId: show.id,
        excludeOpportunityId: capture.opportunityId,
        extractionConfig: extractionResolved.config,
        credentialApiKey: extractionResolved.credential.apiKey,
        captureId,
      });
      if (dedupeResult.matchedOpportunityId) {
        console.log(
          `[processCapture] dedupe → ${dedupeResult.matchedOpportunityId} (conf=${dedupeResult.confidence}): ${dedupeResult.reasoning}`,
        );
        await mergeIntoExistingOpportunity({
          captureId,
          fromOpportunityId: capture.opportunityId,
          toOpportunityId: dedupeResult.matchedOpportunityId,
          newFields: mergedNew,
          newConfidence: confidenceScores,
          photoBlobKey: capture.photoBlobKey,
        });
        dedupeApplied = true;
      } else {
        console.log(
          `[processCapture] no dedupe (conf=${dedupeResult.confidence}, candidates=${dedupeResult.candidateCount}, ${dedupeResult.reasoning})`,
        );
      }
    } catch (e) {
      console.error('[processCapture] dedupe failed:', (e as Error).message);
    }
  }

  // 7c. If not deduped, upsert the lead under this capture's opportunity
  if (!dedupeApplied) {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(leads)
        .where(eq(leads.opportunityId, capture.opportunityId))
        .limit(1);

      let mergedFields: Record<string, unknown>;
      let combinedConfidence: Record<string, number>;
      let processedIds: string[];
      if (!existing) {
        mergedFields = mergedNew;
        combinedConfidence = confidenceScores;
        processedIds = [captureId];
      } else {
        if (existing.processedCaptureIds.includes(captureId)) return;
        mergedFields = { ...existing.mergedFields };
        combinedConfidence = { ...existing.confidenceScores };
        for (const [k, v] of Object.entries(mergedNew)) {
          const oldConf = combinedConfidence[k] ?? 0;
          const newConf = confidenceScores[k] ?? 0.5;
          if (newConf > oldConf || mergedFields[k] == null) {
            mergedFields[k] = v;
            combinedConfidence[k] = newConf;
          }
        }
        processedIds = [...existing.processedCaptureIds, captureId];
      }
      const missingFields = computeMissingFields(mergedFields, requiredFields);

      if (!existing) {
        await tx.insert(leads).values({
          opportunityId: capture.opportunityId,
          mergedFields,
          missingFields,
          confidenceScores: combinedConfidence,
          badgePhotoBlobKey: capture.photoBlobKey,
          processedCaptureIds: processedIds,
          lastUpdatedAt: new Date(),
        });
      } else {
        await tx
          .update(leads)
          .set({
            mergedFields,
            missingFields,
            confidenceScores: combinedConfidence,
            badgePhotoBlobKey: existing.badgePhotoBlobKey ?? capture.photoBlobKey,
            processedCaptureIds: processedIds,
            lastUpdatedAt: new Date(),
          })
          .where(eq(leads.opportunityId, capture.opportunityId));
      }
    });
  }

  // 7.5 Shadow A/B runs (don't affect mergedFields; produce extra extraction rows)
  if (capture.audioBlobKey && transcriptionConfig) {
    const shadow = await resolveShadowProviderConfig({
      showId: show.id,
      kind: 'transcription',
      primaryConfigId: transcriptionConfig.id,
    });
    if (shadow) await runShadowTranscription(shadow, capture.audioBlobKey, captureId);
  }
  if (capture.photoBlobKey && visionConfig) {
    const shadow = await resolveShadowProviderConfig({
      showId: show.id,
      kind: 'vision',
      primaryConfigId: visionConfig.id,
    });
    if (shadow) await runShadowVision(shadow, capture.photoBlobKey, leadSchema, captureId);
  }
  if (transcript && extractionConfig) {
    const shadow = await resolveShadowProviderConfig({
      showId: show.id,
      kind: 'extraction',
      primaryConfigId: extractionConfig.id,
    });
    if (shadow) await runShadowExtraction(shadow, transcript, leadSchema, captureId);
  }

  // Mark-processed is handled by the wrapping processCapture try/finally
  // — see top of this file. We leave a no-op reference here so the
  // opportunities import isn't flagged unused.
  void opportunities;
}

async function runShadowTranscription(
  config: ProviderConfig,
  audioBlobKey: string,
  captureId: string,
): Promise<void> {
  try {
    const audio = await downloadBlob({ bucket: AUDIO_BUCKET, key: audioBlobKey });
    const credential = await loadCredential(config.credentialId, {
      purpose: 'transcription_shadow',
      contextId: captureId,
    });
    const provider = getTranscriptionProvider(config);
    const result = await provider.transcribe({
      ctx: { config, credential, captureId },
      audio: audio.buffer,
      mimeType: audio.mimeType,
    });
    await db.insert(captureExtractions).values({
      captureId,
      transcriptionProviderConfigId: config.id,
      transcript: result.transcript,
      extractedFields: {},
      badgeFields: {},
      modelVersions: { transcription: result.modelVersion, mode: 'shadow' },
      latencyMs: { transcription: result.latencyMs },
      costEstimateUsd: result.costEstimateUsd?.toString() ?? null,
    });
  } catch (e) {
    console.error('[processCapture] shadow transcription failed:', (e as Error).message);
  }
}

async function runShadowVision(
  config: ProviderConfig,
  photoBlobKey: string,
  leadSchema: ReturnType<typeof buildLeadSchema>,
  captureId: string,
): Promise<void> {
  try {
    const photo = await downloadBlob({ bucket: PHOTO_BUCKET, key: photoBlobKey });
    const credential = await loadCredential(config.credentialId, {
      purpose: 'vision_shadow',
      contextId: captureId,
    });
    const provider = getVisionProvider(config);
    const instructions =
      config.defaultInstructions ||
      "Extract visible fields from this trade-show name badge.";
    const result = await provider.extractFromImage({
      ctx: { config, credential, captureId },
      image: photo.buffer,
      mimeType: photo.mimeType,
      schema: leadSchema,
      instructions,
    });
    await db.insert(captureExtractions).values({
      captureId,
      transcriptionProviderConfigId: null,
      transcript: null,
      extractedFields: {},
      badgeFields: result.fields as Record<string, unknown>,
      modelVersions: { vision: result.modelVersion, mode: 'shadow' },
      latencyMs: { vision: result.latencyMs },
      costEstimateUsd: null,
    });
  } catch (e) {
    console.error('[processCapture] shadow vision failed:', (e as Error).message);
  }
}

async function runShadowExtraction(
  config: ProviderConfig,
  transcript: string,
  leadSchema: ReturnType<typeof buildLeadSchema>,
  captureId: string,
): Promise<void> {
  try {
    const credential = await loadCredential(config.credentialId, {
      purpose: 'extraction_shadow',
      contextId: captureId,
    });
    const provider = getExtractionProvider(config);
    const instructions =
      config.defaultInstructions ||
      'Extract lead information from this trade-show conversation transcript.';
    const result = await provider.extractFromText({
      ctx: { config, credential, captureId },
      text: transcript,
      schema: leadSchema,
      instructions,
    });
    await db.insert(captureExtractions).values({
      captureId,
      transcriptionProviderConfigId: null,
      transcript: null,
      extractedFields: result.fields as Record<string, unknown>,
      badgeFields: {},
      modelVersions: { extraction: result.modelVersion, mode: 'shadow' },
      latencyMs: { extraction: result.latencyMs },
      costEstimateUsd: null,
    });
  } catch (e) {
    console.error('[processCapture] shadow extraction failed:', (e as Error).message);
  }
}
