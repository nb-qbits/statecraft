-- Step 1: Add columns as nullable (existing rows have no values yet)
ALTER TABLE "source_documents" ADD COLUMN "jurisdiction" varchar(255);--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "session" varchar(64);--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "instrument_type" varchar(32);--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "number" varchar(64);--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "stage" varchar(64);--> statement-breakpoint

-- Step 2: Backfill from document_versions (earliest version per document)
UPDATE "source_documents" sd
SET
  "jurisdiction" = sub."jurisdiction",
  "session" = sub."session",
  "instrument_type" = sub."instrument_type",
  "number" = sub."number",
  "stage" = sub."stage"
FROM (
  SELECT DISTINCT ON (dv."document_id")
    dv."document_id",
    dv."legal_identity"->>'jurisdiction' AS "jurisdiction",
    dv."legal_identity"->>'session' AS "session",
    dv."legal_identity"->>'instrumentType' AS "instrument_type",
    dv."legal_identity"->>'number' AS "number",
    dv."legal_identity"->>'stage' AS "stage"
  FROM "document_versions" dv
  ORDER BY dv."document_id", dv."created_at" ASC
) sub
WHERE sd."document_id" = sub."document_id";--> statement-breakpoint

-- Step 3: Delete source_documents with no versions (orphans)
DELETE FROM "source_documents"
WHERE "jurisdiction" IS NULL;--> statement-breakpoint

-- Step 4: Reconcile duplicates — reparent versions from duplicate documents to the winner
-- (earliest document per legal identity tuple)
WITH winners AS (
  SELECT DISTINCT ON ("jurisdiction", "session", "instrument_type", "number", "stage")
    "document_id", "jurisdiction", "session", "instrument_type", "number", "stage"
  FROM "source_documents"
  ORDER BY "jurisdiction", "session", "instrument_type", "number", "stage", "created_at" ASC
),
losers AS (
  SELECT sd."document_id" AS loser_id, w."document_id" AS winner_id
  FROM "source_documents" sd
  JOIN winners w ON
    sd."jurisdiction" = w."jurisdiction" AND
    sd."session" = w."session" AND
    sd."instrument_type" = w."instrument_type" AND
    sd."number" = w."number" AND
    sd."stage" = w."stage"
  WHERE sd."document_id" != w."document_id"
)
UPDATE "document_versions" dv
SET "document_id" = l.winner_id
FROM losers l
WHERE dv."document_id" = l.loser_id;--> statement-breakpoint

-- Step 5: Remove duplicate version rows created by reparenting
-- (keep earliest per document_id + content_hash)
DELETE FROM "document_versions"
WHERE "document_version_id" IN (
  SELECT "document_version_id" FROM (
    SELECT "document_version_id",
      ROW_NUMBER() OVER (
        PARTITION BY "document_id", "content_hash"
        ORDER BY "created_at" ASC
      ) AS rn
    FROM "document_versions"
  ) ranked WHERE rn > 1
);--> statement-breakpoint

-- Step 6: Delete loser source_documents (now have no versions)
DELETE FROM "source_documents"
WHERE "document_id" NOT IN (
  SELECT DISTINCT "document_id" FROM "document_versions"
);--> statement-breakpoint

-- Step 7: Set columns NOT NULL now that all rows are backfilled
ALTER TABLE "source_documents" ALTER COLUMN "jurisdiction" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "session" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "instrument_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "stage" SET NOT NULL;--> statement-breakpoint

-- Step 8: Add unique index
CREATE UNIQUE INDEX "uq_source_document_legal_identity" ON "source_documents" USING btree ("jurisdiction","session","instrument_type","number","stage");
