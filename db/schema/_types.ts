import { customType, pgEnum, pgSchema, uuid } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const providerEnum = pgEnum('provider_kind', [
  'openai',
  'gemini',
  'google_stt',
  'deepgram',
  'anthropic',
]);

export const providerConfigKindEnum = pgEnum('provider_config_kind', [
  'realtime',
  'transcription',
  'vision',
  'extraction',
]);

export const repRoleEnum = pgEnum('rep_role', ['admin', 'rep']);

export const captureStatusEnum = pgEnum('capture_status', [
  'queued',
  'uploaded',
  'processing',
  'processed',
  'failed',
]);

export const opportunityStatusEnum = pgEnum('opportunity_status', [
  'open',
  'merged',
  'closed',
]);

export const mediaKindEnum = pgEnum('media_kind', ['audio', 'photo']);

export const customFieldTypeEnum = pgEnum('custom_field_type', [
  'text',
  'select',
  'multiselect',
  'boolean',
  'number',
]);

export const processingJobStatusEnum = pgEnum('processing_job_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
]);

export const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
});
