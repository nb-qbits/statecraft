CREATE TABLE IF NOT EXISTS "grammar_results" (
  "anchor_id" varchar(128) PRIMARY KEY,
  "document_version_id" uuid NOT NULL REFERENCES "document_versions"("document_version_id"),
  "segment_id" varchar(128) NOT NULL,
  "input_text" varchar(4096) NOT NULL,
  "parsed" boolean NOT NULL,
  "expression" jsonb,
  "failure_reason" varchar(1024),
  "failure_position" integer,
  "grammar_version" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_grammar_results_document_version" ON "grammar_results" ("document_version_id");

ALTER TABLE "document_versions"
  ADD COLUMN IF NOT EXISTS "grammar_status" varchar(32) NOT NULL DEFAULT 'unparsed_grammar',
  ADD COLUMN IF NOT EXISTS "grammar_version" varchar(64);

ALTER TABLE "document_versions"
  ADD CONSTRAINT "chk_grammar_status"
  CHECK ("grammar_status" IN ('unparsed_grammar', 'parsed_grammar'));
