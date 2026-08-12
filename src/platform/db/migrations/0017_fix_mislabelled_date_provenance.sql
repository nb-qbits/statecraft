-- Migration 0017: Fix mislabelled date_provenance rows.
--
-- Migration 0016 defaulted date_provenance to 'computed' for all existing rows.
-- Rows created by edit_and_accept, split, or manual_add are reviewer-asserted,
-- not computed. Rows with empty citations cannot be computed — a computed date
-- requires statutory citations from the resolver.
--
-- This migration:
-- 1. Reclassifies all rows whose review action is edit_and_accept/split/manual_add
-- 2. Reclassifies all rows with empty citations (regardless of action)
-- 3. Populates a citation from the review_events table for traceability

UPDATE register_records rr
SET
  date_provenance = 'reviewer_asserted',
  citations = jsonb_build_array(
    'reviewer_asserted: date ' || rr.deadline_date
    || ' supplied by ' || re.reviewer_id
    || ' via ' || re.action
    || ' — migrated: row was mislabelled as computed by migration 0016'
  )
FROM review_events re
WHERE rr.review_event_id = re.event_id
  AND rr.date_provenance = 'computed'
  AND (
    rr.citations = '[]'::jsonb
    OR re.action IN ('edit_and_accept', 'split', 'manual_add')
  );
