-- Bridge to the email-marketing side (eSputnik). Every address handed over is
-- recorded here, so: the same lead is never exported twice, each batch is
-- auditable, and outcomes reported back (bounce/complaint/unsub) flow into our
-- own suppression list instead of being lost on the other side.
CREATE TABLE IF NOT EXISTS lead_exports (
  email        TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,             -- soundcloud | spotify | youtube | beatport
  batch        TEXT NOT NULL,             -- e.g. 'sc-2026-09-08-p1'
  exported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome      TEXT,                      -- delivered | opened | clicked | bounced | complained | unsubscribed | cold
  outcome_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lead_exports_batch ON lead_exports (batch);
CREATE INDEX IF NOT EXISTS idx_lead_exports_outcome ON lead_exports (outcome) WHERE outcome IS NOT NULL;
