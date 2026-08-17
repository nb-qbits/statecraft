-- Add 'generic_default' to date_provenance check constraint on register_records
ALTER TABLE register_records DROP CONSTRAINT IF EXISTS chk_date_provenance;
ALTER TABLE register_records ADD CONSTRAINT chk_date_provenance
  CHECK (date_provenance IN ('computed','generic_default','reviewer_asserted','verbatim_from_instrument'));
