ALTER TABLE anchor_results ADD COLUMN depends_on_quoted_text text;
ALTER TABLE anchor_results ADD COLUMN depends_on_description text;
ALTER TABLE anchor_results ADD COLUMN depends_on_anchored boolean;

ALTER TABLE proposals ADD COLUMN depends_on_description text;
