-- Migration 0016: Add date_provenance to register_records
-- A date on the authoritative register must declare where it came from:
-- computed (resolver derived it), reviewer_asserted (human supplied it),
-- or verbatim_from_instrument (copied from statutory text).

ALTER TABLE register_records
  ADD COLUMN date_provenance varchar(32) NOT NULL DEFAULT 'computed';

ALTER TABLE register_records
  ADD CONSTRAINT chk_date_provenance
  CHECK (date_provenance IN ('computed', 'reviewer_asserted', 'verbatim_from_instrument'));
