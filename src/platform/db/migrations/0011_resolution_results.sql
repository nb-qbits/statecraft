CREATE TABLE IF NOT EXISTS "resolution_results" (
  "anchor_id" varchar(128) PRIMARY KEY,
  "document_version_id" uuid NOT NULL REFERENCES "document_versions"("document_version_id"),
  "segment_id" varchar(128) NOT NULL,
  "input_text" varchar(4096) NOT NULL,
  "expression_kind" varchar(64) NOT NULL,
  "expression" jsonb NOT NULL,
  "resolved" boolean NOT NULL,
  "statutory_date" varchar(10),
  "adjusted_date" varchar(10),
  "rule_ids" jsonb,
  "citations" jsonb,
  "pack_version" varchar(64),
  "warnings" jsonb NOT NULL,
  "reason" varchar(1024),
  "missing_inputs" jsonb,
  "resolution_inputs" jsonb NOT NULL,
  "resolver_version" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_resolution_results_document_version" ON "resolution_results" ("document_version_id");

ALTER TABLE "document_versions"
  ADD COLUMN IF NOT EXISTS "resolution_status" varchar(32) NOT NULL DEFAULT 'unresolved_resolver',
  ADD COLUMN IF NOT EXISTS "resolver_version" varchar(64);

ALTER TABLE "document_versions"
  ADD CONSTRAINT "chk_resolution_status"
  CHECK ("resolution_status" IN ('unresolved_resolver', 'resolved_resolver'));
