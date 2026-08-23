ALTER TABLE resolution_results
  ADD COLUMN IF NOT EXISTS contingency varchar(2048),
  ADD COLUMN IF NOT EXISTS derivation_depth integer;
