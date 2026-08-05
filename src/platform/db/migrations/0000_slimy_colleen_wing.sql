CREATE TABLE "document_versions" (
	"document_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"byte_size" integer NOT NULL,
	"legal_identity" jsonb NOT NULL,
	"legislative_status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"authoritative_source" varchar(2048),
	"as_of_date" varchar(10),
	"retrieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"document_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_source_documents_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."source_documents"("document_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_document_version_content_hash" ON "document_versions" USING btree ("document_id","content_hash");