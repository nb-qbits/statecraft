ALTER TABLE "document_versions" ADD COLUMN "status_provenance" varchar(32) DEFAULT 'default_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "chk_legislative_status" CHECK ("document_versions"."legislative_status" IN ('introduced','engrossed','enrolled','enacted','vetoed','failed','unknown'));--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "chk_status_provenance" CHECK ("document_versions"."status_provenance" IN ('caller_asserted','metadata_source','default_unknown'));--> statement-breakpoint

-- Normalize existing jurisdiction values to canonical lowercase region codes
UPDATE "source_documents" SET "jurisdiction" = 'us-va' WHERE LOWER("jurisdiction") IN ('virginia', 'va');--> statement-breakpoint
UPDATE "source_documents" SET "jurisdiction" = 'us-dc' WHERE LOWER("jurisdiction") IN ('district of columbia', 'dc');--> statement-breakpoint
UPDATE "source_documents" SET "jurisdiction" = 'us-fed' WHERE LOWER("jurisdiction") IN ('federal', 'united states');--> statement-breakpoint
UPDATE "source_documents" SET "jurisdiction" = LOWER("jurisdiction") WHERE "jurisdiction" != LOWER("jurisdiction");--> statement-breakpoint

-- Normalize jurisdiction in document_versions legalIdentity jsonb
UPDATE "document_versions"
SET "legal_identity" = jsonb_set(
  "legal_identity",
  '{jurisdiction}',
  to_jsonb(sd."jurisdiction")
)
FROM "source_documents" sd
WHERE "document_versions"."document_id" = sd."document_id"
  AND "legal_identity"->>'jurisdiction' != sd."jurisdiction";