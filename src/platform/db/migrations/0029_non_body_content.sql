ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS non_body_content JSONB;
