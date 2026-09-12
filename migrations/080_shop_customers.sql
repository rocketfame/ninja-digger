-- Shopify customers, mirrored daily. The fourth line of defence for the mass
-- channel: an address that ever bought or registered in the shop is never a
-- lead, whatever eSputnik happens to know about it.
CREATE TABLE IF NOT EXISTS shop_customers (
  email        TEXT PRIMARY KEY,
  shopify_id   BIGINT,
  orders_count INT DEFAULT 0,
  created_at   TIMESTAMPTZ,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
