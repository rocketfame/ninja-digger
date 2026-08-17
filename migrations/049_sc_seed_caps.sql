-- Per-seed harvest caps + completion tracking.
-- A promo channel can have 20k+ followers; parsing all of them would flood the
-- 512MB tier and waste effort on stale accounts. We cap each seed to its newest
-- N followers, mark it completed, and only revisit periodically for new signups.

ALTER TABLE sc_seed_accounts
  ADD COLUMN IF NOT EXISTS harvested_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Rotation index: uncompleted seeds first, then least-recently-touched.
CREATE INDEX IF NOT EXISTS idx_sc_seed_rotation
  ON sc_seed_accounts (completed_at NULLS FIRST, last_harvested_at NULLS FIRST)
  WHERE active = true;
