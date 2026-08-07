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
  follow_up_enabled boolean not null default false,
  follow_up_stage int not null default 0, -- 0=none,1=day1,2=day3,3=day7
  last_customer_message_at timestamptz,
  last_ai_or_staff_message_at timestamptz,
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

-- Knowledge base
create table knowledge_base (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  question text not null, -- example phrasing (BM or EN)
  answer_ms text, -- Bahasa Melayu answer
  answer_en text, -- English answer
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

create policy "authenticated read conversations" on conversations for select to authenticated using (true);
create policy "authenticated read messages" on messages for select to authenticated using (true);
create policy "authenticated read knowledge_base" on knowledge_base for select to authenticated using (true);
create policy "authenticated read system_prompt" on system_prompt for select to authenticated using (true);
create policy "authenticated read token_usage" on token_usage for select to authenticated using (true);
create policy "authenticated read follow_up_log" on follow_up_log for select to authenticated using (true);
create policy "authenticated read staff" on staff for select to authenticated using (true);
