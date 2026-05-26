import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { captureStatusEnum } from './_types';
import { opportunities } from './opportunities';
import { providerConfigs } from './providerConfigs';
import { reps } from './reps';
import { shows } from './shows';

export const captures = pgTable('captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id, { onDelete: 'cascade' }),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  repId: uuid('rep_id').notNull().references(() => reps.id, { onDelete: 'set null' }),
  audioBlobKey: text('audio_blob_key'),
  photoBlobKey: text('photo_blob_key'),
  durationMs: integer('duration_ms'),
  hadRealtimeAssist: boolean('had_realtime_assist').notNull().default(false),
  realtimeProviderConfigId: uuid('realtime_provider_config_id').references(() => providerConfigs.id, { onDelete: 'set null' }),
  realtimeTranscript: jsonb('realtime_transcript').$type<Array<Record<string, unknown>>>(),
  status: captureStatusEnum('status').notNull().default('queued'),
  clientCapturedAt: timestamp('client_captured_at', { withTimezone: true }).notNull(),
  serverReceivedAt: timestamp('server_received_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Capture = typeof captures.$inferSelect;
export type NewCapture = typeof captures.$inferInsert;
