-- Hot lookups compare LOWER(email) / LOWER(TRIM(value)) but the existing indexes
-- are on the raw column, so these paths did full scans (Brevo webhook per event,
-- inbox reply matching every 5 min, blacklist checks). Functional indexes fix it.
CREATE INDEX IF NOT EXISTS idx_sc_artists_email_lower     ON sc_artists    (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_spotify_leads_email_lower  ON spotify_leads (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_radar_leads_email_lower    ON radar_leads   (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_artist_contacts_email_lower_trim ON artist_contacts (type, LOWER(TRIM(value)));

-- notified_replies is pruned by age; index the timestamp for the cleanup delete.
CREATE INDEX IF NOT EXISTS idx_notified_replies_notified_at ON notified_replies (notified_at);
