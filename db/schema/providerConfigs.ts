import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { providerConfigKindEnum, providerEnum } from './_types';
import { providerCredentials } from './providerCredentials';

export const providerConfigs = pgTable('provider_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: providerConfigKindEnum('kind').notNull(),
  provider: providerEnum('provider').notNull(),
  model: text('model').notNull(),
  credentialId: uuid('credential_id')
    .notNull()
    .references(() => providerCredentials.id, { onDelete: 'restrict' }),
  label: text('label').notNull(),
  defaultInstructions: text('default_instructions'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProviderConfig = typeof providerConfigs.$inferSelect;
export type NewProviderConfig = typeof providerConfigs.$inferInsert;
