-- Google Sheets lead capture now fires as soon as a customer shows real
-- product interest (not just on a full staff handoff), and staff can mark
-- whether a lead actually bought. lead_logged_to_sheets dedupes the initial
-- "new lead" row so it's only added once per conversation; sale_outcome is
-- set manually from the dashboard since this system has no checkout -- only
-- a human knows whether a WhatsApp sale actually closed.
alter table conversations add column if not exists lead_logged_to_sheets boolean not null default false;
alter table conversations add column if not exists sale_outcome text; -- 'purchased' | 'not_purchased' | null
