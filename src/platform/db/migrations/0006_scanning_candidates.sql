-- Module 3: Candidate scan tables and document_versions columns

CREATE TABLE IF NOT EXISTS "scan_candidates" (
  "candidate_id" varchar(128) PRIMARY KEY,
  "segment_id" varchar(128) NOT NULL REFERENCES "source_segments"("segment_id"),
  "document_version_id" uuid NOT NULL REFERENCES "document_versions"("document_version_id"),
  "kind" varchar(64) NOT NULL,
  "rule_id" varchar(128) NOT NULL,
  "matched_text" text NOT NULL,
  "match_start" integer NOT NULL,
  "match_end" integer NOT NULL,
  "suppressed" boolean NOT NULL DEFAULT false,
  "scanner_version" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_scan_candidates_segment" ON "scan_candidates" ("segment_id");
CREATE INDEX IF NOT EXISTS "idx_scan_candidates_version" ON "scan_candidates" ("document_version_id");

ALTER TABLE "document_versions"
  ADD COLUMN IF NOT EXISTS "scan_status" varchar(32) NOT NULL DEFAULT 'unscanned',
  ADD COLUMN IF NOT EXISTS "scanner_version" varchar(64);

ALTER TABLE "document_versions"
  DROP CONSTRAINT IF EXISTS "chk_scan_status";

ALTER TABLE "document_versions"
  ADD CONSTRAINT "chk_scan_status" CHECK ("scan_status" IN ('unscanned', 'scanned'));
