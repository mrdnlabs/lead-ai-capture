import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { shows } from './shows';

export const leadForms = pgTable('lead_forms', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sourceSampleCsv: text('source_sample_csv'),
  icaptureHeaders: jsonb('icapture_headers').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LeadForm = typeof leadForms.$inferSelect;
export type NewLeadForm = typeof leadForms.$inferInsert;
