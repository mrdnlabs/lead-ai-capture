import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { mediaKindEnum } from './_types';
import { captures } from './captures';

export const mediaBlobs = pgTable('media_blobs', {
  key: text('key').primaryKey(),
  captureId: uuid('capture_id').notNull().references(() => captures.id, { onDelete: 'cascade' }),
  kind: mediaKindEnum('kind').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MediaBlob = typeof mediaBlobs.$inferSelect;
export type NewMediaBlob = typeof mediaBlobs.$inferInsert;
