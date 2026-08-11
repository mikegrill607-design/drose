-- Design-code image catalog -- lets the AI itself send kain-pasang-style
-- product photos so the customer can browse and pick a specific design
-- code, instead of waiting for staff. This is a deliberate, product-scoped
-- exception to "AI never sends photos" -- every product WITHOUT catalog rows
-- here keeps the old behavior (staff sends the catalog manually after
-- handoff). See src/lib/designCatalog.ts.
--
-- One row per photo, not per design -- a single design code (e.g. "MZF A5")
-- typically has 2-3 photos (a full shot + close-up detail shots), grouped
-- by design_code in application code when sending.
create table design_catalog (
  id uuid primary key default gen_random_uuid(),
  design_code text not null,
  product_topic text not null, -- matches knowledge_base.topic for the product this design belongs to
  material text,
  color text,
  image_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index design_catalog_topic_code_idx on design_catalog (product_topic, design_code);

alter table design_catalog enable row level security;
create policy "authenticated read design_catalog" on design_catalog for select to authenticated using (true);

-- Which design codes have already been shown to a conversation -- lets the
-- webhook recognize when the customer names one of them (the qualifying
-- signal for design-catalog products) instead of re-sending photos on
-- every message, and scopes "did they pick one" to only the codes they
-- were actually shown.
alter table conversations add column if not exists sent_design_codes text[] not null default '{}';
