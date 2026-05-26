import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { providerCredentials } from './providerCredentials';
import { reps } from './reps';

export const credentialAccessLog = pgTable('credential_access_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  credentialId: uuid('credential_id')
    .notNull()
    .references(() => providerCredentials.id, { onDelete: 'cascade' }),
  accessedByRepId: uuid('accessed_by_rep_id').references(() => reps.id, { onDelete: 'set null' }),
  purpose: text('purpose').notNull(),
  contextId: uuid('context_id'),
  accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CredentialAccessEntry = typeof credentialAccessLog.$inferSelect;
export type NewCredentialAccessEntry = typeof credentialAccessLog.$inferInsert;
