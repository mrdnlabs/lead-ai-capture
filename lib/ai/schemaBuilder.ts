import { z } from 'zod';
import type { CustomFieldDefinition } from '@/db/schema';

/**
 * Standard fields every lead has, regardless of the show's custom form.
 * Optional + describe() so the AI knows what they mean.
 */
export const standardLeadFields = z.object({
  name: z.string().describe("The lead's full name").optional(),
  email: z.string().describe('Email address (validate format if confident)').optional(),
  company: z.string().describe("The lead's company / employer").optional(),
  title: z.string().describe('Job title or role').optional(),
  phone: z.string().describe('Phone number, any format').optional(),
  notes: z
    .string()
    .describe('Free-form conversation notes — qualifying answers, next steps, context')
    .optional(),
});

export type StandardLeadFields = z.infer<typeof standardLeadFields>;

/** Convert a single custom_field_definitions row into a Zod field. */
function fieldToZod(def: CustomFieldDefinition): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (def.type) {
    case 'text':
      base = z.string();
      break;
    case 'number':
      base = z.number();
      break;
    case 'boolean':
      base = z.boolean();
      break;
    case 'select': {
      const options = def.options ?? [];
      base = options.length > 0 ? z.enum(options as [string, ...string[]]) : z.string();
      break;
    }
    case 'multiselect': {
      const options = def.options ?? [];
      base = z.array(options.length > 0 ? z.enum(options as [string, ...string[]]) : z.string());
      break;
    }
    default:
      base = z.string();
  }
  const desc = def.aiExtractionHint || def.label;
  return base.describe(desc).optional();
}

/**
 * Combine standard fields with the show's custom_field_definitions into a
 * single Zod object schema. Used by both vision and extraction providers so
 * model output drops straight into leads.mergedFields + the iCapture CSV.
 */
export function buildLeadSchema(customFields: CustomFieldDefinition[]) {
  const customShape: Record<string, z.ZodTypeAny> = {};
  for (const def of customFields) {
    customShape[def.key] = fieldToZod(def);
  }
  return standardLeadFields.extend(customShape);
}

export type LeadFieldsRaw = Record<string, unknown>;
