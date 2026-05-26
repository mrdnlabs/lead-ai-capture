import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import type { TranscriptionProvider, TranscriptionResult } from '../types';

// Gemini doesn't ship a dedicated transcription endpoint; it transcribes via
// the standard generateContent API with audio input. Quality is best on
// gemini-2.5-flash and gemini-3.1-flash; pricing per token is far cheaper
// than OpenAI's per-minute Whisper variants.
export const geminiAudioTranscriptionProvider: TranscriptionProvider = {
  kind: 'transcription',
  async transcribe({ ctx, audio, mimeType, language }): Promise<TranscriptionResult> {
    const start = Date.now();
    const google = createGoogleGenerativeAI({ apiKey: ctx.credential.apiKey });
    const model = ctx.config.model || 'gemini-2.5-flash';
    const result = await generateText({
      model: google(model),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              data: audio,
              mediaType: mimeType,
            },
            {
              type: 'text',
              text: `Transcribe the audio verbatim${
                language ? ` (language: ${language})` : ''
              }. Return only the transcript, no preamble.`,
            },
          ],
        },
      ],
    });
    const latencyMs = Date.now() - start;
    return {
      transcript: result.text.trim(),
      language,
      latencyMs,
      modelVersion: model,
    };
  },
};
