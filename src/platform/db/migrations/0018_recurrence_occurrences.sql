-- Module 13: Recurrence and Occurrences
-- Add RRULE and recurrence data to resolution_results
ALTER TABLE "resolution_results" ADD COLUMN "rrule" varchar(512);
ALTER TABLE "resolution_results" ADD COLUMN "recurrence_data" jsonb;

-- Add RRULE to proposals for recurrence tracking
ALTER TABLE "proposals" ADD COLUMN "rrule" varchar(512);

-- Add RRULE to register_records for ICS export
ALTER TABLE "register_records" ADD COLUMN "rrule" varchar(512);

-- Occurrence table for materialized recurrence instances
CREATE TABLE IF NOT EXISTS "deadline_occurrences" (
  "occurrence_id" varchar(128) PRIMARY KEY,
  "record_version_id" varchar(128) NOT NULL,
  "occurrence_date" varchar(10) NOT NULL,
  "adjusted_date" varchar(10) NOT NULL,
  "rule_ids" jsonb NOT NULL,
  "citations" jsonb NOT NULL,
  "sequence_number" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_occurrences_record_version" ON "deadline_occurrences" ("record_version_id");
CREATE INDEX IF NOT EXISTS "idx_occurrences_date" ON "deadline_occurrences" ("occurrence_date");
