import { boolean, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { customFieldTypeEnum } from './_types';
import { leadForms } from './leadForms';

export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadFormId: uuid('lead_form_id').notNull().references(() => leadForms.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  label: text('label').notNull(),
  type: customFieldTypeEnum('type').notNull(),
  options: jsonb('options').$type<string[]>(),
  required: boolean('required').notNull().default(false),
  aiExtractionHint: text('ai_extraction_hint'),
  csvHeader: text('csv_header').notNull(),
  ordering: integer('ordering').notNull().default(0),
});

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
export type NewCustomFieldDefinition = typeof customFieldDefinitions.$inferInsert;
