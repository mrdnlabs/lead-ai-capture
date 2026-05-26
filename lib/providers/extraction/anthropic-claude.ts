import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import type { z } from 'zod';
import type { ExtractionProvider, ExtractionResult } from '../types';

export const anthropicClaudeExtractionProvider: ExtractionProvider = {
  kind: 'extraction',
  async extractFromText<TSchema extends z.ZodTypeAny>({
    ctx,
    text,
    schema,
    instructions,
  }: {
    ctx: { credential: { apiKey: string }; config: { model: string } };
    text: string;
    schema: TSchema;
    instructions: string;
  }): Promise<ExtractionResult<TSchema>> {
    const start = Date.now();
    const anthropic = createAnthropic({ apiKey: ctx.credential.apiKey });
    const model = ctx.config.model || 'claude-sonnet-4-6';
    const result = await generateObject({
      model: anthropic(model),
      schema,
      prompt: `${instructions}\n\n---\nTranscript:\n${text}`,
    });
    return {
      fields: result.object as z.infer<TSchema>,
      latencyMs: Date.now() - start,
      modelVersion: model,
    };
  },
};
