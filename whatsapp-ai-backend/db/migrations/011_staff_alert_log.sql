-- Staff WhatsApp alerts (handoff notifications, 2-day reminders) were never
-- logged anywhere -- there was no row for a delivery-status webhook event to
-- match against, so even Meta's own confirmation of success/failure was
-- unrecoverable after the fact. This makes "did that staff alert actually
-- arrive, and if not why" answerable from the database instead of guesswork.
create table staff_alert_log (
  id uuid primary key default gen_random_uuid(),
  staff_whatsapp_number text not null,
  conversation_id uuid references conversations(id),
  kind text not null, -- 'handoff' | 'reminder' | 'test'
  sent_via text not null, -- 'text' | 'template'
  wa_message_id text,
  delivery_status text, -- sent | delivered | read | failed | null (not yet reported)
  delivery_error text,
  created_at timestamptz not null default now()
);
create index staff_alert_log_wa_message_id_idx on staff_alert_log (wa_message_id);

alter table staff_alert_log enable row level security;
create policy "authenticated read staff_alert_log" on staff_alert_log for select to authenticated using (true);
