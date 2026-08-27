ALTER TABLE anchor_results ADD COLUMN IF NOT EXISTS obligation_title TEXT;
ALTER TABLE anchor_results ADD COLUMN IF NOT EXISTS section_citation TEXT;

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS obligation_title TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS section_citation TEXT;

ALTER TABLE resolution_results ADD COLUMN IF NOT EXISTS date_role VARCHAR(16);
