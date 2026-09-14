-- Mass channel measurement.
-- shop_orders: every shop order mirrored from Shopify, with the three things
-- that attribute it to the mass channel — the MAX* code, the buyer's email
-- (matched against lead_exports) and the landing page's utm_source.
-- mass_pushes: what we planned and what we actually handed over per day and
-- platform, so the page can show plan vs fact.
CREATE TABLE IF NOT EXISTS shop_orders (
  order_id     BIGINT PRIMARY KEY,
  name         TEXT,
  email        TEXT,
  total        NUMERIC(10,2),
  currency     TEXT,
  codes        TEXT[] DEFAULT '{}',
  landing      TEXT,
  utm_source   TEXT,
  created_at   TIMESTAMPTZ NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_orders_email ON shop_orders (email);
CREATE INDEX IF NOT EXISTS idx_shop_orders_created ON shop_orders (created_at);

CREATE TABLE IF NOT EXISTS mass_pushes (
  day        DATE NOT NULL,
  platform   TEXT NOT NULL,
  planned    INT NOT NULL DEFAULT 0,   -- what the knob asked for (esputnik_daily_push)
  budget     INT NOT NULL DEFAULT 0,   -- what the base/window allowed that day
  pushed     INT NOT NULL DEFAULT 0,   -- what actually landed in the group
  PRIMARY KEY (day, platform)
);
