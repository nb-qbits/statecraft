-- Backfill ordinal as a zero-based document-order sequence.
-- Previous behavior: ordinal was always 0 (per-group disambiguator with all unique groups).
-- New behavior: ordinal is the segment's position in the document (0, 1, 2, ...).
--
-- Uses ctid ordering as best-effort insertion-order proxy.
-- All segment IDs will change on re-parse because ordinal is part of the identity hash.
-- Downstream references (scan_candidates.segment_id, model_calls) become stale.

-- Step 1: Backfill ordinals from insertion order
WITH numbered AS (
  SELECT segment_id,
         ROW_NUMBER() OVER (
           PARTITION BY document_version_id
           ORDER BY ctid
         ) - 1 AS new_ordinal
  FROM source_segments
)
UPDATE source_segments
SET ordinal = numbered.new_ordinal
FROM numbered
WHERE source_segments.segment_id = numbered.segment_id;

-- Step 2: Clear stale scan candidates (reference old segment IDs)
DELETE FROM scan_candidates;

-- Step 3: Clear stale model calls (reference old segment IDs via correlation)
DELETE FROM model_calls;

-- Step 4: Reset scan and extraction status so documents get re-processed
UPDATE document_versions
SET scan_status = 'unscanned',
    scanner_version = NULL,
    extraction_status = 'unextracted',
    extractor_version = NULL
WHERE scan_status != 'unscanned' OR extraction_status != 'unextracted';
