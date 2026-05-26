import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { repRoleEnum } from './_types';

// id matches auth.users(id). FK + sync trigger applied in db/supabase/setup.sql.
export const reps = pgTable('reps', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  role: repRoleEnum('role').notNull().default('rep'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Rep = typeof reps.$inferSelect;
export type NewRep = typeof reps.$inferInsert;
