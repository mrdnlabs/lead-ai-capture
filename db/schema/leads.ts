import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { opportunities } from './opportunities';

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .unique()
    .references(() => opportunities.id, { onDelete: 'cascade' }),
  mergedFields: jsonb('merged_fields').$type<Record<string, unknown>>().notNull().default({}),
  missingFields: jsonb('missing_fields').$type<string[]>().notNull().default([]),
  confidenceScores: jsonb('confidence_scores').$type<Record<string, number>>().notNull().default({}),
  badgePhotoBlobKey: text('badge_photo_blob_key'),
  processedCaptureIds: jsonb('processed_capture_ids').$type<string[]>().notNull().default([]),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).notNull().defaultNow(),
  exportedAt: timestamp('exported_at', { withTimezone: true }),
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
