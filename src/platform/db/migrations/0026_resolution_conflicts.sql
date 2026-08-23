CREATE TABLE IF NOT EXISTS "resolution_conflicts" (
  "conflict_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_version_id" uuid NOT NULL REFERENCES "document_versions"("document_version_id"),
  "anchor_id" varchar(128) NOT NULL,
  "record_id" uuid NOT NULL REFERENCES "register_records"("record_id"),
  "previous_statutory_date" varchar(10) NOT NULL,
  "previous_adjusted_date" varchar(10) NOT NULL,
  "new_statutory_date" varchar(10),
  "new_adjusted_date" varchar(10),
  "new_resolved" boolean NOT NULL,
  "previous_grammar_version" varchar(64) NOT NULL,
  "new_grammar_version" varchar(64) NOT NULL,
  "previous_resolver_version" varchar(64) NOT NULL,
  "new_resolver_version" varchar(64) NOT NULL,
  "conflict_status" varchar(32) NOT NULL DEFAULT 'pending_review',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolved_by" varchar(256),
  CONSTRAINT "chk_conflict_status" CHECK ("conflict_status" IN ('pending_review'))
);

CREATE INDEX IF NOT EXISTS "idx_conflicts_dvid" ON "resolution_conflicts" ("document_version_id");
CREATE INDEX IF NOT EXISTS "idx_conflicts_record" ON "resolution_conflicts" ("record_id");
CREATE INDEX IF NOT EXISTS "idx_conflicts_status" ON "resolution_conflicts" ("conflict_status");
