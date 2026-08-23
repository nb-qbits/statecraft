ALTER TABLE review_events DROP CONSTRAINT IF EXISTS chk_review_action;
ALTER TABLE review_events ADD CONSTRAINT chk_review_action
  CHECK (action IN ('accept','edit_and_accept','reject','split','manual_add','edit_record'));
