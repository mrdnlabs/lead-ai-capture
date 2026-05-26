import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import type { z } from 'zod';
import type { VisionProvider, VisionResult } from '../types';

export const geminiVisionProvider: VisionProvider = {
  kind: 'vision',
  async extractFromImage<TSchema extends z.ZodTypeAny>({
    ctx,
    image,
    mimeType,
    schema,
    instructions,
  }: {
    ctx: { credential: { apiKey: string }; config: { model: string } };
    image: Buffer;
    mimeType: string;
    schema: TSchema;
    instructions: string;
  }): Promise<VisionResult<TSchema>> {
    const start = Date.now();
    const google = createGoogleGenerativeAI({ apiKey: ctx.credential.apiKey });
    const model = ctx.config.model || 'gemini-2.5-flash';
    const result = await generateObject({
      model: google(model),
      schema,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image, mediaType: mimeType },
            { type: 'text', text: instructions },
          ],
        },
      ],
    });
    return {
      fields: result.object as z.infer<TSchema>,
      latencyMs: Date.now() - start,
      modelVersion: model,
    };
  },
};
