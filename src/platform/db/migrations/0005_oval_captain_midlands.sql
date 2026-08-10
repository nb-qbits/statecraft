CREATE TABLE "source_segments" (
	"segment_id" varchar(128) PRIMARY KEY NOT NULL,
	"document_version_id" uuid NOT NULL,
	"structural_path" varchar(1024) NOT NULL,
	"ordinal" integer NOT NULL,
	"raw_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"offset_map" jsonb NOT NULL,
	"parser_adapter" varchar(64) NOT NULL,
	"parser_version" varchar(64) NOT NULL,
	"fidelity" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fidelity" CHECK ("source_segments"."fidelity" IN ('declared','inferred','none'))
);
--> statement-breakpoint
ALTER TABLE "source_segments" ADD CONSTRAINT "source_segments_document_version_id_document_versions_document_version_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("document_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_segment_identity" ON "source_segments" USING btree ("document_version_id","structural_path","content_hash","ordinal");