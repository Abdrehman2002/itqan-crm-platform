-- Link a sales ticket to the deal it was converted into.
-- When a 'sales' ticket is accepted (or explicitly converted), we create a deal in
-- the pipeline and record its id here so the enquiry-to-revenue trail is preserved
-- and we never create a duplicate deal for the same ticket.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_deal ON tickets(tenant_id, deal_id);
