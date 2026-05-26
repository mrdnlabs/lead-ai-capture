import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { providerConfigs } from '@/db/schema';
import { getExtractionProvider } from '@/lib/providers';
import { loadCredential } from '@/lib/providers/credentials';

export const inferredFieldSchema = z.object({
  csvHeader: z.string().describe('Exact header text from the CSV column'),
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .describe(
      'snake_case field key. Use standard keys when applicable: name, email, company, title, phone, notes. Otherwise derive from the label.',
    ),
  label: z.string().describe('Human-readable label for the field'),
  type: z.enum(['text', 'select', 'multiselect', 'boolean', 'number']),
  options: z
    .array(z.string())
    .optional()
    .describe('For select/multiselect only — distinct values seen in the sample row.'),
  required: z
    .boolean()
    .describe('True if this looks like a mandatory field (name, email, etc.) or a qualifying question that should be answered.'),
  aiExtractionHint: z
    .string()
    .optional()
    .describe('A short hint that helps a downstream AI know how to fill this field from a conversation.'),
});

export const inferredFormSchema = z.object({
  fields: z.array(inferredFieldSchema),
});

export type InferredField = z.infer<typeof inferredFieldSchema>;
export type InferredForm = z.infer<typeof inferredFormSchema>;

const SYSTEM_INSTRUCTIONS = `You are analyzing a sample CSV export from iCapture (a trade-show lead capture tool).
Each CSV column will become a lead field in our system.

For each column, return:
- csvHeader: the EXACT column header text from the CSV (preserve casing, punctuation, spacing)
- key: a snake_case identifier. **Map to one of these standard keys when the column matches**: name, email, company, title, phone, notes. Otherwise derive from the label.
- label: a human-readable label
- type: text / select / multiselect / boolean / number. Use select if the value clearly came from a small fixed list (e.g., levels 1-5, yes/no, "very interested" / "somewhat"). Use multiselect if the cell contains separators like ; or |.
- options: for select/multiselect, list the candidate options (include the values you see in the sample row).
- required: true for name, email; true for anything that looks like a qualifying question. False for nice-to-haves.
- aiExtractionHint: short one-sentence hint to guide a downstream AI in extracting this field from a conversation transcript.

Do not invent columns. One entry per CSV column. Preserve the order of columns in the CSV.`;

export async function inferLeadFormFromCsv(sampleCsv: string): Promise<InferredForm> {
  const [config] = await db
    .select()
    .from(providerConfigs)
    .where(and(eq(providerConfigs.kind, 'extraction'), eq(providerConfigs.isDefault, true)))
    .limit(1);
  if (!config) throw new Error('No default extraction provider configured');

  const credential = await loadCredential(config.credentialId, {
    purpose: 'lead_form_inference',
  });
  const provider = getExtractionProvider(config);
  const result = await provider.extractFromText({
    ctx: { config, credential, captureId: 'lead_form_inference' },
    text: sampleCsv,
    schema: inferredFormSchema,
    instructions: SYSTEM_INSTRUCTIONS,
  });
  return result.fields as InferredForm;
}
