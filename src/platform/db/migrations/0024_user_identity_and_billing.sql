-- Users: lightweight per-browser identity (not full auth — Phase B)
CREATE TABLE users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan VARCHAR(32) NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_plan CHECK (plan IN ('free', 'waitlisted'))
);

-- Track which bills belong to which user (for limit enforcement)
CREATE TABLE user_bills (
  user_id UUID NOT NULL REFERENCES users(user_id),
  document_version_id UUID NOT NULL REFERENCES document_versions(document_version_id),
  archived VARCHAR(5) NOT NULL DEFAULT 'false',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_version_id)
);
CREATE INDEX idx_user_bills_user ON user_bills(user_id);
CREATE INDEX idx_user_bills_dvid ON user_bills(document_version_id);

-- Waitlist / lead capture for paywall moments
CREATE TABLE waitlist_entries (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  email VARCHAR(512) NOT NULL,
  trigger VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_waitlist_trigger CHECK (trigger IN ('bill_limit', 'calendar_sync'))
);
CREATE INDEX idx_waitlist_user ON waitlist_entries(user_id);

-- Google Calendar OAuth connections
CREATE TABLE calendar_connections (
  connection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  provider VARCHAR(32) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  calendar_id VARCHAR(512),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_calendar_conn_user ON calendar_connections(user_id);

-- Track synced calendar events for update/delete
CREATE TABLE synced_events (
  sync_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES calendar_connections(connection_id),
  document_version_id UUID NOT NULL REFERENCES document_versions(document_version_id),
  record_version_id UUID NOT NULL,
  google_event_id VARCHAR(512) NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_synced_events_conn ON synced_events(connection_id);
CREATE INDEX idx_synced_events_dvid ON synced_events(document_version_id);
CREATE INDEX idx_synced_events_record ON synced_events(record_version_id);
