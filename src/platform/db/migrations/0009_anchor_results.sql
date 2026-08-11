CREATE TABLE anchor_results (
  anchor_id VARCHAR(128) PRIMARY KEY,
  document_version_id VARCHAR(128) NOT NULL,
  segment_id VARCHAR(128) NOT NULL,
  quoted_text TEXT NOT NULL,
  kind VARCHAR(64) NOT NULL,
  anchored BOOLEAN NOT NULL,
  method VARCHAR(32),
  normalized_start INTEGER,
  normalized_end INTEGER,
  original_start INTEGER,
  original_end INTEGER,
  reason TEXT,
  anchorer_version VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_anchor_method CHECK (method IS NULL OR method IN ('exact', 'normalized_exact', 'fuzzy'))
);

CREATE INDEX idx_anchor_results_document ON anchor_results (document_version_id);
CREATE INDEX idx_anchor_results_segment ON anchor_results (segment_id);

ALTER TABLE document_versions
  ADD COLUMN anchoring_status VARCHAR(32) NOT NULL DEFAULT 'unanchored',
  ADD COLUMN anchorer_version VARCHAR(64);

ALTER TABLE document_versions
  ADD CONSTRAINT chk_anchoring_status CHECK (anchoring_status IN ('unanchored', 'anchored', 'anchoring_failed'));
