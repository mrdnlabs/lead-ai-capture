import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { reps } from './reps';
import { shows } from './shows';

export const showReps = pgTable(
  'show_reps',
  {
    showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
    repId: uuid('rep_id').notNull().references(() => reps.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('rep'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.showId, t.repId] })],
);

export type ShowRep = typeof showReps.$inferSelect;
export type NewShowRep = typeof showReps.$inferInsert;
