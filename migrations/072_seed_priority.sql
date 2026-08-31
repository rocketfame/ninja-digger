-- Re-Ex / promoter seeds (paying advertisers, highest-intent) must be harvested
-- and refreshed before the cold social-graph seeds. priority: 2=Re-Ex/promoter,
-- 0=graph fill.
ALTER TABLE sc_seed_accounts ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 0;
