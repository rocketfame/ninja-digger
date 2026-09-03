-- brevo-poll re-fetched the same window hourly and inserted every event again
-- (no unique key) → ~93% duplicate rows, opens counters inflated ~24x.
-- 1) collapse duplicates (keep the earliest row per email/event/day)
DELETE FROM email_events a USING email_events b
 WHERE a.id > b.id AND a.email = b.email AND a.event = b.event
   AND date_trunc('day', a.ts) = date_trunc('day', b.ts);
-- 2) idempotency key for the poller (Brevo event timestamp)
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_events_email_event_ts ON email_events (email, event, ts);
-- 3) rebuild engagement counters from the deduped log
UPDATE sc_artists s SET opens = sub.o, clicks = sub.c
  FROM (SELECT email, COUNT(*) FILTER (WHERE event IN ('opened','uniqueopened')) o, COUNT(*) FILTER (WHERE event LIKE 'click%') c FROM email_events GROUP BY 1) sub
 WHERE LOWER(s.email) = sub.email AND (s.opens <> sub.o OR s.clicks <> sub.c);
UPDATE spotify_leads s SET opens = sub.o, clicks = sub.c
  FROM (SELECT email, COUNT(*) FILTER (WHERE event IN ('opened','uniqueopened')) o, COUNT(*) FILTER (WHERE event LIKE 'click%') c FROM email_events GROUP BY 1) sub
 WHERE LOWER(s.email) = sub.email AND (s.opens <> sub.o OR s.clicks <> sub.c);
UPDATE artist_contacts a SET opens = sub.o
  FROM (SELECT email, COUNT(*) FILTER (WHERE event IN ('opened','uniqueopened')) o FROM email_events GROUP BY 1) sub
 WHERE a.type = 'email' AND LOWER(TRIM(a.value)) = sub.email AND a.opens <> sub.o;
-- spotify-crawl attempt marker so failed crawls are not retried every hour
ALTER TABLE spotify_leads ADD COLUMN IF NOT EXISTS crawl_attempted_at TIMESTAMPTZ;
