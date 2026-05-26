import { jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { captures } from './captures';
import { providerConfigs } from './providerConfigs';

export const captureExtractions = pgTable('capture_extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  captureId: uuid('capture_id').notNull().references(() => captures.id, { onDelete: 'cascade' }),
  transcriptionProviderConfigId: uuid('transcription_provider_config_id')
    .references(() => providerConfigs.id, { onDelete: 'set null' }),
  transcript: text('transcript'),
  extractedFields: jsonb('extracted_fields').$type<Record<string, unknown>>().notNull().default({}),
  badgeFields: jsonb('badge_fields').$type<Record<string, unknown>>().notNull().default({}),
  modelVersions: jsonb('model_versions').$type<Record<string, string>>().notNull().default({}),
  latencyMs: jsonb('latency_ms').$type<Record<string, number>>().notNull().default({}),
  costEstimateUsd: numeric('cost_estimate_usd', { precision: 10, scale: 6 }),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CaptureExtraction = typeof captureExtractions.$inferSelect;
export type NewCaptureExtraction = typeof captureExtractions.$inferInsert;
