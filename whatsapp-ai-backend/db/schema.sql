-- Run this in the Supabase SQL editor for a new project.
-- After running, enable Realtime on `conversations` and `messages`
-- (Database -> Replication in the Supabase dashboard).

-- Conversations: one per customer phone number
create table conversations (
  id uuid primary key default gen_random_uuid(),
  customer_phone text unique not null,
  customer_name text,
  detected_language text, -- 'ms' | 'en'
  status text not null default 'ai_active', -- ai_active | awaiting_staff | staff_handling
  follow_up_enabled boolean not null default true, -- automatic for every lead by default; staff can opt a conversation out
  follow_up_stage int not null default 0, -- 0=none, 1=first follow-up sent, 2=second (final) follow-up sent
  follow_up_last_sent_at timestamptz, -- when stage 1 was actually sent -- stage 2's 2-day wait is measured from this, not from last_customer_message_at
  last_customer_message_at timestamptz,
  last_ai_or_staff_message_at timestamptz,
  staff_reminder_sent boolean not null default false, -- one nudge per untouched handoff, see cron/staffReminder.ts
  lead_logged_to_sheets boolean not null default false, -- dedupes the initial Google Sheets lead row, see src/lib/googleSheets.ts
  sale_outcome text, -- 'purchased' | 'not_purchased' | null -- set manually by staff, no checkout in this system
  sent_design_codes text[] not null default '{}', -- design_catalog codes already shown to this customer, see src/lib/designCatalog.ts
  sent_size_chart boolean not null default false, -- dedupes the size-chart auto-send, see src/lib/sizeChart.ts
  created_at timestamptz not null default now()
);

-- Messages: full chat log
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) not null,
  sender text not null, -- customer | ai | staff
  content text not null, -- caption text; '' for an image with no caption
  media_url text, -- set for image messages (catalog photos, customer-sent images)
  wa_message_id text,
  tokens_used int, -- populated for AI-generated messages
  delivery_status text, -- sent | delivered | read | failed | null, from Meta's status webhook events
  delivery_error text, -- Meta's error detail, only set when delivery_status = 'failed'
  created_at timestamptz not null default now()
);

-- Staff (create before follow_up_log, which references it)
create table staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  whatsapp_number text not null, -- receives handoff notifications, managed from dashboard Settings page
  auth_user_id uuid references auth.users(id)
);

-- WhatsApp Business + integration settings (managed from dashboard Settings page, not hardcoded env vars)
create table app_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, -- 'whatsapp_app_id' | 'whatsapp_business_account_id' | 'whatsapp_phone_number_id'
                             -- | 'whatsapp_access_token' | 'whatsapp_verify_token'
                             -- | 'llm_provider' ('groq' | 'openai') | 'llm_api_key' | 'llm_model'
  value text not null,
  updated_by uuid references staff(id),
  updated_at timestamptz not null default now()
);
-- whatsapp_access_token and llm_api_key are sensitive. Restrict table access to service_role
-- only via RLS (no anon/authenticated read policy on this table) -- the dashboard writes to
-- it through the Railway backend's /settings API route (service role key), never directly
-- from the browser. Each client can bring their own Groq or OpenAI key via llm_api_key.
alter table app_settings enable row level security;

-- Follow-up log (both automatic and custom)
create table follow_up_log (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) not null,
  stage int, -- 1, 2, 3, or null if custom
  message_type text not null default 'auto', -- 'auto' | 'custom'
  content text,
  sent_at timestamptz not null default now(),
  sent_by uuid references staff(id) -- null if sent by system
);

-- Knowledge base: one uploaded-PDF document per category (topic), not
-- manual Q&A rows. keywords widens what customer phrasing matches this
-- category beyond what's literally in the topic name -- see
-- src/lib/kbRouter.ts, which picks relevant categories per message instead
-- of sending the whole KB on every AI call.
create table knowledge_base (
  id uuid primary key default gen_random_uuid(),
  topic text not null unique,
  content text not null, -- extracted PDF text (or typed), any language -- the AI translates as needed
  keywords text, -- comma-separated aliases, e.g. "baju,shirt,lelaki"
  source_filename text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- System prompt (owner-editable, versioned)
create table system_prompt (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  is_active boolean not null default true,
  updated_by uuid references staff(id),
  created_at timestamptz not null default now()
);

-- WhatsApp Message Templates -- required by Meta to message a customer
-- outside the 24-hour session window (e.g. Day 1/3/7 follow-ups). Draft rows
-- are created locally first; "Submit for review" calls Meta's API and sets
-- meta_template_id + status.
create table whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- Meta-safe slug: lowercase, digits, underscores only
  language text not null default 'ms',
  category text not null default 'MARKETING', -- 'MARKETING' | 'UTILITY'
  header_text text, -- optional short line above the body, its own single {{1}} if used
  header_example text, -- example value for the header's {{1}}, if present
  body_text text not null, -- may contain {{1}}, {{2}} placeholders
  variable_examples text[], -- one example value per placeholder -- Meta requires these to review
  footer_text text,
  meta_template_id text,
  status text not null default 'draft', -- draft | pending | approved | rejected | paused | disabled
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Staff WhatsApp alerts (handoff notifications, 2-day reminders) -- logs
-- every send attempt so a delivery-status webhook event (sent/delivered/
-- read/failed, with Meta's real error on failure) has something to match
-- against. See src/lib/staffNotify.ts.
create table staff_alert_log (
  id uuid primary key default gen_random_uuid(),
  staff_whatsapp_number text not null,
  conversation_id uuid references conversations(id),
  kind text not null, -- 'handoff' | 'reminder' | 'test'
  sent_via text not null, -- 'text' | 'template'
  wa_message_id text,
  delivery_status text,
  delivery_error text,
  created_at timestamptz not null default now()
);
create index staff_alert_log_wa_message_id_idx on staff_alert_log (wa_message_id);
alter table staff_alert_log enable row level security;
create policy "authenticated read staff_alert_log" on staff_alert_log for select to authenticated using (true);

-- Design-code image catalog -- lets the AI itself send kain-pasang-style
-- product photos so the customer can pick a design code, instead of
-- waiting for staff (a deliberate, product-scoped exception to "AI never
-- sends photos" -- products with no rows here keep the old behavior). One
-- row per photo, not per design -- a design code (e.g. "MZF A5") typically
-- has 2-3 photos, grouped by design_code in application code. See
-- src/lib/designCatalog.ts.
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

-- Size chart reference images -- simpler than design_catalog: no "pick a
-- code" step, just a fixed set of images (e.g. short/long sleeve
-- measurement charts) auto-sent once when a customer shows interest in a
-- product that has one. See src/lib/sizeChart.ts.
create table size_chart_images (
  id uuid primary key default gen_random_uuid(),
  product_topic text not null,
  label text,
  image_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index size_chart_images_topic_idx on size_chart_images (product_topic);
alter table size_chart_images enable row level security;
create policy "authenticated read size_chart_images" on size_chart_images for select to authenticated using (true);

-- Token usage log (for cost monitoring)
create table token_usage (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  prompt_tokens int not null,
  completion_tokens int not null,
  total_tokens int not null,
  model text not null,
  created_at timestamptz not null default now()
);

-- Dashboard staff read conversations/messages/KB/prompt/usage directly via
-- Supabase (anon key + Supabase Auth), but never write except through the
-- Railway backend. Enable RLS + policies once staff auth roles are finalized;
-- until then these tables are readable to any authenticated dashboard user.
alter table conversations enable row level security;
alter table messages enable row level security;
alter table knowledge_base enable row level security;
alter table system_prompt enable row level security;
alter table token_usage enable row level security;
alter table follow_up_log enable row level security;
alter table staff enable row level security;
alter table whatsapp_templates enable row level security;

create policy "authenticated read conversations" on conversations for select to authenticated using (true);
create policy "authenticated read messages" on messages for select to authenticated using (true);
create policy "authenticated read knowledge_base" on knowledge_base for select to authenticated using (true);
create policy "authenticated read system_prompt" on system_prompt for select to authenticated using (true);
create policy "authenticated read token_usage" on token_usage for select to authenticated using (true);
create policy "authenticated read follow_up_log" on follow_up_log for select to authenticated using (true);
create policy "authenticated read staff" on staff for select to authenticated using (true);
create policy "authenticated read whatsapp_templates" on whatsapp_templates for select to authenticated using (true);
