import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { reps } from './reps';

export const shows = pgTable('shows', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  leadFormId: uuid('lead_form_id'),
  realtimeProviderConfigId: uuid('realtime_provider_config_id'),
  transcriptionProviderConfigId: uuid('transcription_provider_config_id'),
  visionProviderConfigId: uuid('vision_provider_config_id'),
  extractionProviderConfigId: uuid('extraction_provider_config_id'),
  createdBy: uuid('created_by').references(() => reps.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Show = typeof shows.$inferSelect;
export type NewShow = typeof shows.$inferInsert;
