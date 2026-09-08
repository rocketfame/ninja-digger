-- Verification ledger: the result of the SMTP mailbox check for every address
-- we have probed, not just the dead ones. Without this we could only say "N
-- addresses were removed" and never "X% of the queue is verified" — which is
-- the question that matters before a send.
CREATE TABLE IF NOT EXISTS email_verification (
  email       TEXT PRIMARY KEY,
  verdict     TEXT NOT NULL,              -- valid | invalid | catch_all | unknown
  note        TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verification_verdict ON email_verification (verdict);
CREATE INDEX IF NOT EXISTS idx_email_verification_checked ON email_verification (checked_at DESC);

-- Backfill what we already know from the first passes: everything the SMTP
-- check quarantined is a confirmed dead mailbox.
INSERT INTO email_verification (email, verdict, note, checked_at)
SELECT LOWER(email), 'invalid', 'backfill from blacklist', created_at
  FROM email_blacklist WHERE reason LIKE '%smtp: mailbox%'
ON CONFLICT (email) DO NOTHING;
