import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authUsers, repRoleEnum } from './_types';

export const reps = pgTable('reps', {
  id: uuid('id').primaryKey().references(() => authUsers.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  role: repRoleEnum('role').notNull().default('rep'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Rep = typeof reps.$inferSelect;
export type NewRep = typeof reps.$inferInsert;
