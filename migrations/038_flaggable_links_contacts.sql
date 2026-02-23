-- Add status column to artist_links and artist_contacts for flagging incorrect entries.
-- Values: 'ok' (default), 'flagged' (marked incorrect by user).

ALTER TABLE artist_links
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok';

ALTER TABLE artist_contacts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok';

CREATE INDEX IF NOT EXISTS idx_artist_links_status ON artist_links (status) WHERE status != 'ok';
CREATE INDEX IF NOT EXISTS idx_artist_contacts_status ON artist_contacts (status) WHERE status != 'ok';
