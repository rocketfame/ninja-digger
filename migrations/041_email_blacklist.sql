-- Email blacklist: block specific emails from all outreach pipelines
CREATE TABLE IF NOT EXISTS email_blacklist (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_blacklist_email ON email_blacklist(email);
