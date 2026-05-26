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
    return;
  }

  await db.update(captures).set({ status: 'processing' }).where(eq(captures.id, captureId));

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

  // 3. Resolve provider configs
  const [transcriptionConfig, visionConfig, extractionConfig] = await Promise.all([
    resolveProviderConfig({
      showId: show.id,
      kind: 'transcription',
      overrideConfigId: show.transcriptionProviderConfigId,
    }),
    resolveProviderConfig({
      showId: show.id,
      kind: 'vision',
      overrideConfigId: show.visionProviderConfigId,
    }),
    resolveProviderConfig({
      showId: show.id,
      kind: 'extraction',
      overrideConfigId: show.extractionProviderConfigId,
    }),
  ]);

  // 4. Transcribe (if audio + transcription config)
  let transcript = '';
  let transcriptLatencyMs: number | undefined;
  let transcriptCost: number | undefined;
  let transcriptionModelVersion: string | undefined;
  if (capture.audioBlobKey && transcriptionConfig) {
    try {
      const audio = await downloadBlob({ bucket: AUDIO_BUCKET, key: capture.audioBlobKey });
      const credential = await loadCredential(transcriptionConfig.credentialId, {
        purpose: 'transcription',
        contextId: captureId,
      });
      const provider = getTranscriptionProvider(transcriptionConfig);
      const result = await provider.transcribe({
        ctx: { config: transcriptionConfig, credential, captureId },
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

  // 5. Vision-extract (if photo + vision config)
  let badgeFields: Record<string, unknown> = {};
  let visionLatencyMs: number | undefined;
  let visionModelVersion: string | undefined;
  if (capture.photoBlobKey && visionConfig) {
    try {
      const photo = await downloadBlob({ bucket: PHOTO_BUCKET, key: capture.photoBlobKey });
      const credential = await loadCredential(visionConfig.credentialId, {
        purpose: 'vision',
        contextId: captureId,
      });
      const provider = getVisionProvider(visionConfig);
      const instructions =
        visionConfig.defaultInstructions ||
        'You are looking at a photo of a person\'s trade-show name badge. Extract the visible fields. If a field is not visible or unreadable, leave it out — do not guess.';
      const result = await provider.extractFromImage({
        ctx: { config: visionConfig, credential, captureId },
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

  // 6. Extract from transcript (if transcript + extraction config)
  let transcriptFields: Record<string, unknown> = {};
  let extractionLatencyMs: number | undefined;
  let extractionModelVersion: string | undefined;
  if (transcript && extractionConfig) {
    try {
      const credential = await loadCredential(extractionConfig.credentialId, {
        purpose: 'extraction',
        contextId: captureId,
      });
      const provider = getExtractionProvider(extractionConfig);
      const instructions =
        extractionConfig.defaultInstructions ||
        'Extract lead information from this trade-show conversation transcript. The rep is talking about a lead they met. Extract only what the rep actually said or implied — do not invent facts.';
      const result = await provider.extractFromText({
        ctx: { config: extractionConfig, credential, captureId },
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

  // 7. Merge into leads row (idempotent — skip if already processed)
  const mergedNew = mergeFields(badgeFields, transcriptFields);
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(leads)
      .where(eq(leads.opportunityId, capture.opportunityId))
      .limit(1);

    let mergedFields: Record<string, unknown>;
    let processedIds: string[];
    if (!existing) {
      mergedFields = mergedNew;
      processedIds = [captureId];
    } else {
      if (existing.processedCaptureIds.includes(captureId)) {
        return; // already merged
      }
      mergedFields = { ...existing.mergedFields, ...mergedNew };
      processedIds = [...existing.processedCaptureIds, captureId];
    }
    const missingFields = computeMissingFields(mergedFields, requiredFields);

    if (!existing) {
      await tx.insert(leads).values({
        opportunityId: capture.opportunityId,
        mergedFields,
        missingFields,
        confidenceScores: {},
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
          badgePhotoBlobKey: existing.badgePhotoBlobKey ?? capture.photoBlobKey,
          processedCaptureIds: processedIds,
          lastUpdatedAt: new Date(),
        })
        .where(eq(leads.opportunityId, capture.opportunityId));
    }

    await tx.insert(captureExtractions).values({
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
  });

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

  // 8. Mark processed
  await db.update(captures).set({ status: 'processed' }).where(eq(captures.id, captureId));

  // 9. Ensure an opportunity is at least marked as "open" still (no-op for now)
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
