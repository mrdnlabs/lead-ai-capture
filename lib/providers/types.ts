import type { z } from 'zod';
import type { ProviderConfig, ProviderCredential } from '@/db/schema';

export interface DecryptedCredential {
  id: string;
  provider: ProviderCredential['provider'];
  apiKey: string;
}

export interface ProviderCallContext {
  config: ProviderConfig;
  credential: DecryptedCredential;
  captureId: string;
}

export interface TranscriptionResult {
  transcript: string;
  language?: string;
  durationSec?: number;
  latencyMs: number;
  costEstimateUsd?: number;
  modelVersion: string;
}

export interface TranscriptionProvider {
  kind: 'transcription';
  transcribe(args: {
    ctx: ProviderCallContext;
    audio: Buffer;
    mimeType: string;
    language?: string;
  }): Promise<TranscriptionResult>;
}

export interface VisionResult<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  fields: z.infer<TSchema>;
  latencyMs: number;
  costEstimateUsd?: number;
  modelVersion: string;
}

export interface VisionProvider {
  kind: 'vision';
  extractFromImage<TSchema extends z.ZodTypeAny>(args: {
    ctx: ProviderCallContext;
    image: Buffer;
    mimeType: string;
    schema: TSchema;
    instructions: string;
  }): Promise<VisionResult<TSchema>>;
}

export interface ExtractionResult<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  fields: z.infer<TSchema>;
  latencyMs: number;
  costEstimateUsd?: number;
  modelVersion: string;
}

export interface ExtractionProvider {
  kind: 'extraction';
  extractFromText<TSchema extends z.ZodTypeAny>(args: {
    ctx: ProviderCallContext;
    text: string;
    schema: TSchema;
    instructions: string;
  }): Promise<ExtractionResult<TSchema>>;
}
