-- Run this once in the Supabase SQL editor. Stores WhatsApp Message
-- Templates staff create from the dashboard (Configure -> Templates) --
-- required by Meta to message a customer outside the 24-hour session
-- window (e.g. Day 1/3/7 follow-ups). Draft rows are created locally first;
-- "Submit for review" calls Meta's API and sets meta_template_id + status.
create table whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- Meta-safe slug: lowercase, digits, underscores only
  language text not null default 'ms', -- Meta language code, e.g. 'ms' or 'en'
  category text not null default 'MARKETING', -- 'MARKETING' | 'UTILITY'
  body_text text not null, -- may contain {{1}}, {{2}} placeholders
  variable_examples text[], -- one example value per placeholder -- Meta requires these to review
  footer_text text,
  meta_template_id text, -- set once submitted to Meta
  status text not null default 'draft', -- draft | pending | approved | rejected | paused | disabled
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table whatsapp_templates enable row level security;
create policy "authenticated read whatsapp_templates" on whatsapp_templates for select to authenticated using (true);
-- Writes only through the Railway backend (service role), same pattern as knowledge_base.
