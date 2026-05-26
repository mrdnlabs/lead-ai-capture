import { anthropicClaudeExtractionProvider } from './extraction/anthropic-claude';
import { geminiExtractionProvider } from './extraction/gemini';
import { geminiAudioTranscriptionProvider } from './transcription/gemini-audio';
import { openaiGpt4oTranscribeProvider } from './transcription/openai-gpt4o-transcribe';
import { anthropicClaudeVisionProvider } from './vision/anthropic-claude';
import { geminiVisionProvider } from './vision/gemini';
import type {
  ExtractionProvider,
  TranscriptionProvider,
  VisionProvider,
} from './types';
import type { ProviderConfig } from '@/db/schema';

export function getTranscriptionProvider(config: ProviderConfig): TranscriptionProvider {
  if (config.kind !== 'transcription') throw new Error(`Not a transcription config: ${config.id}`);
  switch (config.provider) {
    case 'openai':
      return openaiGpt4oTranscribeProvider;
    case 'gemini':
      return geminiAudioTranscriptionProvider;
    default:
      throw new Error(`No transcription provider for: ${config.provider}`);
  }
}

export function getVisionProvider(config: ProviderConfig): VisionProvider {
  if (config.kind !== 'vision') throw new Error(`Not a vision config: ${config.id}`);
  switch (config.provider) {
    case 'anthropic':
      return anthropicClaudeVisionProvider;
    case 'gemini':
      return geminiVisionProvider;
    default:
      throw new Error(`No vision provider for: ${config.provider}`);
  }
}

export function getExtractionProvider(config: ProviderConfig): ExtractionProvider {
  if (config.kind !== 'extraction') throw new Error(`Not an extraction config: ${config.id}`);
  switch (config.provider) {
    case 'anthropic':
      return anthropicClaudeExtractionProvider;
    case 'gemini':
      return geminiExtractionProvider;
    default:
      throw new Error(`No extraction provider for: ${config.provider}`);
  }
}
