-- Create normalised lane_assignments table
CREATE TABLE IF NOT EXISTS "lane_assignments" (
  "anchor_id" varchar(128) PRIMARY KEY,
  "document_version_id" uuid NOT NULL REFERENCES "document_versions"("document_version_id"),
  "segment_id" varchar(128) NOT NULL,
  "lane" varchar(32) NOT NULL,
  "reasons" jsonb NOT NULL,
  "router_version" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_lane_assignments_lane_dvid"
  ON "lane_assignments" ("lane", "document_version_id");

CREATE INDEX IF NOT EXISTS "idx_lane_assignments_dvid"
  ON "lane_assignments" ("document_version_id");

-- Backfill from existing routing_results JSONB.
-- Each routing_results row has an "assignments" JSONB array; each element has
-- anchorId, segmentId, lane, and reasons.
INSERT INTO "lane_assignments" (
  "anchor_id",
  "document_version_id",
  "segment_id",
  "lane",
  "reasons",
  "router_version",
  "created_at"
)
SELECT
  a->>'anchorId',
  rr."document_version_id",
  a->>'segmentId',
  a->>'lane',
  a->'reasons',
  rr."router_version",
  rr."created_at"
FROM "routing_results" rr,
     jsonb_array_elements(rr."assignments") AS a
ON CONFLICT ("anchor_id") DO NOTHING;
