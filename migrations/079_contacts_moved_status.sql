-- A Beatport contact whose artist has not charted in 14 days is not a Beatport
-- lead any more; it becomes a Spotify lead (the artist almost certainly has a
-- Spotify presence) and the Beatport row is retired with status 'moved' so the
-- pipeline never mails it. 'moved' is a new terminal state next to blocked/bounced.
ALTER TABLE artist_contacts DROP CONSTRAINT IF EXISTS artist_contacts_status_check;
ALTER TABLE artist_contacts ADD CONSTRAINT artist_contacts_status_check CHECK (status IN ('ok', 'flagged', 'blocked', 'bounced', 'moved'));
