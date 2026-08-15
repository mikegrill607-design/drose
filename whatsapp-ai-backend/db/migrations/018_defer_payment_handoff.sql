-- Run this once in the Supabase SQL editor.
-- Kain Pasang used to hand off to staff the instant a customer picked a
-- payment method (right when the QR code was sent) -- staff got pinged
-- before the customer had actually paid anything. This column lets the
-- webhook keep the AI "active" for that one customer a little longer,
-- watching specifically for the receipt photo, and only hand off once it
-- arrives (see src/routes/webhook.ts).
alter table conversations
  add column if not exists awaiting_payment_receipt boolean not null default false;
