CREATE TABLE IF NOT EXISTS "projects" (
  "project_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(512) NOT NULL,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "analyses" (
  "analysis_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_version_id" uuid NOT NULL REFERENCES "document_versions"("document_version_id"),
  "config_hash" varchar(128) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "error" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "chk_analysis_status" CHECK ("status" IN ('pending','running','completed','failed'))
);

CREATE UNIQUE INDEX "uq_analysis_dvid_config" ON "analyses" ("document_version_id", "config_hash");

CREATE TABLE IF NOT EXISTS "proposals" (
  "proposal_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "analysis_id" uuid NOT NULL REFERENCES "analyses"("analysis_id"),
  "document_version_id" uuid NOT NULL REFERENCES "document_versions"("document_version_id"),
  "anchor_id" varchar(128) NOT NULL,
  "segment_id" varchar(128) NOT NULL,
  "quoted_text" text NOT NULL,
  "kind" varchar(64) NOT NULL,
  "normalized_start" integer NOT NULL,
  "normalized_end" integer NOT NULL,
  "original_start" integer NOT NULL,
  "original_end" integer NOT NULL,
  "anchoring_method" varchar(32) NOT NULL,
  "parsed_expression" jsonb,
  "resolved" boolean NOT NULL,
  "statutory_date" varchar(10),
  "adjusted_date" varchar(10),
  "rule_ids" jsonb NOT NULL,
  "citations" jsonb NOT NULL,
  "pack_version" varchar(64),
  "support_level" varchar(32) NOT NULL,
  "lane" varchar(32) NOT NULL,
  "lane_reasons" jsonb NOT NULL,
  "proposal_status" varchar(32) NOT NULL DEFAULT 'pending_review',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_proposal_status" CHECK ("proposal_status" IN ('pending_review','accepted','rejected','split'))
);

CREATE UNIQUE INDEX "uq_proposal_analysis_anchor" ON "proposals" ("analysis_id", "anchor_id");
CREATE INDEX "idx_proposals_dvid" ON "proposals" ("document_version_id");
CREATE INDEX "idx_proposals_status" ON "proposals" ("proposal_status");

CREATE TABLE IF NOT EXISTS "review_events" (
  "event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "proposal_id" uuid REFERENCES "proposals"("proposal_id"),
  "action" varchar(32) NOT NULL,
  "reviewer_id" varchar(256) NOT NULL,
  "before_values" jsonb,
  "after_values" jsonb NOT NULL,
  "diff" jsonb NOT NULL,
  "idempotency_key" varchar(256) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_review_action" CHECK ("action" IN ('accept','edit_and_accept','reject','split','manual_add'))
);

CREATE UNIQUE INDEX "uq_review_event_idempotency" ON "review_events" ("idempotency_key");
CREATE INDEX "idx_review_events_proposal" ON "review_events" ("proposal_id");

CREATE TABLE IF NOT EXISTS "register_records" (
  "record_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "record_version_id" uuid NOT NULL UNIQUE,
  "proposal_id" uuid REFERENCES "proposals"("proposal_id"),
  "review_event_id" uuid NOT NULL REFERENCES "review_events"("event_id"),
  "document_version_id" uuid NOT NULL REFERENCES "document_versions"("document_version_id"),
  "anchor_id" varchar(128),
  "segment_id" varchar(128),
  "quoted_text" text,
  "kind" varchar(64) NOT NULL,
  "deadline_date" varchar(10) NOT NULL,
  "adjusted_date" varchar(10) NOT NULL,
  "rule_ids" jsonb NOT NULL,
  "citations" jsonb NOT NULL,
  "pack_version" varchar(64),
  "deliverable" text,
  "actor" text,
  "conditions" text,
  "record_status" varchar(32) NOT NULL DEFAULT 'active',
  "split_from_record_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_record_status" CHECK ("record_status" IN ('active','superseded'))
);

CREATE INDEX "idx_register_records_dvid" ON "register_records" ("document_version_id");
CREATE INDEX "idx_register_records_status" ON "register_records" ("record_status");
CREATE INDEX "idx_register_records_proposal" ON "register_records" ("proposal_id");

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "key" varchar(256) PRIMARY KEY,
  "endpoint" varchar(512) NOT NULL,
  "response_status" integer NOT NULL,
  "response_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
