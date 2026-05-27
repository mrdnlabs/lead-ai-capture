-- Add a JSONB column to captures for fields the AI collected via tool calls
-- during a live conversation. Separate from realtime_transcript (which is the
-- raw dialog log) and badge/extracted fields (which are post-hoc).
ALTER TABLE "captures" ADD COLUMN IF NOT EXISTS "live_fields" jsonb;
