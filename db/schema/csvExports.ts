import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { reps } from './reps';
import { shows } from './shows';

export const csvExports = pgTable('csv_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  generatedByRepId: uuid('generated_by_rep_id').references(() => reps.id, { onDelete: 'set null' }),
  rowCount: integer('row_count').notNull(),
  blobKey: text('blob_key').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CsvExport = typeof csvExports.$inferSelect;
export type NewCsvExport = typeof csvExports.$inferInsert;
