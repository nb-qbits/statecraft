-- Part 2: Accountable parties — promote actor to first-class field

ALTER TABLE anchor_results ADD COLUMN actor text;
ALTER TABLE anchor_results ADD COLUMN actor_quoted_text text;
ALTER TABLE anchor_results ADD COLUMN actor_anchored boolean;

ALTER TABLE proposals ADD COLUMN actor text;
ALTER TABLE proposals ADD COLUMN actor_quoted_text text;

CREATE INDEX idx_register_records_actor ON register_records (actor);
