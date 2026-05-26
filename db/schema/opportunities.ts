import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { opportunityStatusEnum } from './_types';
import { reps } from './reps';
import { shows } from './shows';

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    status: opportunityStatusEnum('status').notNull().default('open'),
    createdByRepId: uuid('created_by_rep_id').references(() => reps.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('opportunities_show_code_unique').on(t.showId, t.code)],
);

export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
