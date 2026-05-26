import { createOpenAI } from '@ai-sdk/openai';
import { experimental_transcribe as transcribe } from 'ai';
import type { TranscriptionProvider, TranscriptionResult } from '../types';

// Pricing (May 2026, per OpenAI docs):
//   gpt-4o-transcribe: $0.006/min
//   gpt-4o-mini-transcribe: $0.003/min
const PRICE_PER_MINUTE: Record<string, number> = {
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-1': 0.006,
};

export const openaiGpt4oTranscribeProvider: TranscriptionProvider = {
  kind: 'transcription',
  async transcribe({ ctx, audio, language }): Promise<TranscriptionResult> {
    const start = Date.now();
    const openai = createOpenAI({ apiKey: ctx.credential.apiKey });
    const model = ctx.config.model || 'gpt-4o-transcribe';
    const result = await transcribe({
      model: openai.transcription(model),
      audio,
      providerOptions: language ? { openai: { language } } : undefined,
    });
    const latencyMs = Date.now() - start;
    const durationSec = result.durationInSeconds;
    const pricePerMinute = PRICE_PER_MINUTE[model];
    const costEstimateUsd =
      pricePerMinute && durationSec ? (durationSec / 60) * pricePerMinute : undefined;
    return {
      transcript: result.text,
      language: result.language,
      durationSec,
      latencyMs,
      costEstimateUsd,
      modelVersion: model,
    };
  },
};
