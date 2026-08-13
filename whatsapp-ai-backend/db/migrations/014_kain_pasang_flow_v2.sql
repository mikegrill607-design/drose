-- Payment method QR codes (e.g. Maybank, Bank Islam) -- the AI sends the
-- matching one automatically once a customer has chosen a design and named
-- a preferred payment method. Not product-specific -- one flat list shared
-- across whichever products use this flow.
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  method_name text not null, -- e.g. "Maybank", "Bank Islam"
  account_holder text,
  account_number text,
  image_url text not null, -- the QR code image
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table payment_methods enable row level security;
create policy "authenticated read payment_methods" on payment_methods for select to authenticated using (true);

-- Kain-pasang-style browsing state: which design code the customer settled
-- on (once chosen, the next customer reply is interpreted as their payment
-- method answer, not a new design request), and which payment method they
-- picked. Both null until reached; used alongside the existing
-- sent_design_codes (now used as a running "already shown" list across
-- multiple batches, not just a single one-shot send).
alter table conversations add column if not exists chosen_design_code text;
alter table conversations add column if not exists payment_method_chosen text;
