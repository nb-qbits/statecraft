CREATE TABLE IF NOT EXISTS "model_calls" (
  "model_call_id" varchar(128) PRIMARY KEY,
  "document_version_id" varchar(128) NOT NULL,
  "segment_id" varchar(128) NOT NULL,
  "model_id" varchar(256) NOT NULL,
  "prompt_hash" varchar(128) NOT NULL,
  "request_payload" text NOT NULL,
  "response_payload" text NOT NULL,
  "input_tokens" integer NOT NULL,
  "output_tokens" integer NOT NULL,
  "latency_ms" integer NOT NULL,
  "correlation_id" varchar(256) NOT NULL,
  "repaired" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_model_calls_document_version" ON "model_calls" ("document_version_id");
CREATE INDEX IF NOT EXISTS "idx_model_calls_segment" ON "model_calls" ("segment_id");
CREATE INDEX IF NOT EXISTS "idx_model_calls_prompt_hash" ON "model_calls" ("prompt_hash");

ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "extraction_status" varchar(32) NOT NULL DEFAULT 'unextracted';
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "extractor_version" varchar(64);
ALTER TABLE "document_versions" ADD CONSTRAINT "chk_extraction_status" CHECK ("extraction_status" IN ('unextracted', 'extracted', 'extraction_failed'));
