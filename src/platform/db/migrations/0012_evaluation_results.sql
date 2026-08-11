CREATE TABLE IF NOT EXISTS "evaluation_results" (
  "anchor_id" varchar(128) PRIMARY KEY,
  "document_version_id" uuid NOT NULL REFERENCES "document_versions"("document_version_id"),
  "segment_id" varchar(128) NOT NULL,
  "quoted_text" varchar(4096) NOT NULL,
  "deterministic_passed" boolean NOT NULL,
  "deterministic_checks" jsonb NOT NULL,
  "evaluator_verdict" varchar(32),
  "support_level" varchar(32) NOT NULL,
  "prompt_hash" varchar(128),
  "evaluator_version" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_evaluation_results_document_version" ON "evaluation_results" ("document_version_id");

ALTER TABLE "document_versions"
  ADD COLUMN IF NOT EXISTS "evaluation_status" varchar(32) NOT NULL DEFAULT 'unevaluated',
  ADD COLUMN IF NOT EXISTS "evaluator_version" varchar(64);

ALTER TABLE "document_versions"
  ADD CONSTRAINT "chk_evaluation_status"
  CHECK ("evaluation_status" IN ('unevaluated', 'evaluated'));
