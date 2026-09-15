-- Rotation audit: set once eSputnik confirmed the contact is gone (or was a customer).
ALTER TABLE lead_exports ADD COLUMN IF NOT EXISTS verified_gone BOOLEAN DEFAULT false;
