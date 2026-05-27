import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { reps } from './reps';
import { shows } from './shows';

/**
 * Time-limited invite tokens for joining a show.
 *
 * Token is a URL-safe random string (32 base64 chars). The full invite URL
 * looks like `<origin>/join/<token>`. When redeemed, a `show_reps` row is
 * created for the redeeming rep at the invite's `role`.
 *
 * Multi-use by default (`maxUses = 50`) so a single QR poster at a booth
 * can onboard the team. Set `revokedAt` to disable without deleting.
 */
export const showInvites = pgTable('show_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  role: text('role').notNull().default('rep'), // 'rep' | 'lead'
  maxUses: integer('max_uses').notNull().default(50),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdByRepId: uuid('created_by_rep_id')
    .notNull()
    .references(() => reps.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export type ShowInvite = typeof showInvites.$inferSelect;
export type NewShowInvite = typeof showInvites.$inferInsert;
