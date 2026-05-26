import { integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { providerConfigKindEnum } from './_types';
import { providerConfigs } from './providerConfigs';
import { shows } from './shows';

export const providerAbAssignments = pgTable('provider_ab_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  kind: providerConfigKindEnum('kind').notNull(),
  providerConfigAId: uuid('provider_config_a_id')
    .notNull()
    .references(() => providerConfigs.id, { onDelete: 'restrict' }),
  providerConfigBId: uuid('provider_config_b_id')
    .notNull()
    .references(() => providerConfigs.id, { onDelete: 'restrict' }),
  splitPct: integer('split_pct').notNull().default(50),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProviderAbAssignment = typeof providerAbAssignments.$inferSelect;
export type NewProviderAbAssignment = typeof providerAbAssignments.$inferInsert;
