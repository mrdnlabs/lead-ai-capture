import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea, providerEnum } from './_types';
import { reps } from './reps';

export const providerCredentials = pgTable('provider_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: providerEnum('provider').notNull(),
  label: text('label').notNull(),
  encryptedApiKey: bytea('encrypted_api_key').notNull(),
  encryptionKeyId: text('encryption_key_id').notNull(),
  last4: text('last4').notNull(),
  createdByRepId: uuid('created_by_rep_id').references(() => reps.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  useCount: integer('use_count').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

export type ProviderCredential = typeof providerCredentials.$inferSelect;
export type NewProviderCredential = typeof providerCredentials.$inferInsert;
