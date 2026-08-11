CREATE TABLE IF NOT EXISTS "routing_results" (
  "document_version_id" uuid PRIMARY KEY REFERENCES "document_versions"("document_version_id"),
  "router_version" varchar(64) NOT NULL,
  "assignments" jsonb NOT NULL,
  "coverage" jsonb NOT NULL,
  "lane_summary" jsonb NOT NULL,
  "total_assignments" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "document_versions"
  ADD COLUMN IF NOT EXISTS "routing_status" varchar(32) NOT NULL DEFAULT 'unrouted';

ALTER TABLE "document_versions"
  ADD COLUMN IF NOT EXISTS "router_version" varchar(64);

ALTER TABLE "document_versions"
  DROP CONSTRAINT IF EXISTS "chk_routing_status";

ALTER TABLE "document_versions"
  ADD CONSTRAINT "chk_routing_status" CHECK ("routing_status" IN ('unrouted', 'routed'));
