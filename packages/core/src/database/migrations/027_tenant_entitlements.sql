-- Tenant module + feature entitlements
--
-- `active_modules`    : top-level licensable modules the tenant has (e.g. ['crm','sales']).
-- `entitled_features` : the specific feature-areas within those modules the customer
--                       agreed to (e.g. ['crm.contacts','sales.invoices']). This is the
--                       allow-list the super admin sets at workspace creation.
--
-- active_modules is created IF NOT EXISTS because earlier environments added it ad-hoc.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS active_modules    TEXT[] NOT NULL DEFAULT ARRAY['crm'],
  ADD COLUMN IF NOT EXISTS entitled_features JSONB  NOT NULL DEFAULT '[]'::jsonb;
