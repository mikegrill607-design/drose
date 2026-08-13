-- Run this once in the Supabase SQL editor.
-- Powers the expanded Overview page: conversations-per-day chart, an
-- AI-vs-staff breakdown, and a lead/Kain-Pasang funnel -- all in two round
-- trips instead of pulling every conversation row to the client to count.

create or replace function get_conversations_by_day(days_back int default 14)
returns table (day date, conversation_count bigint)
language sql
stable
as $$
  select date_trunc('day', created_at)::date as day, count(*) as conversation_count
  from conversations
  where created_at >= now() - (days_back || ' days')::interval
  group by 1
  order by 1;
$$;

grant execute on function get_conversations_by_day(int) to authenticated;

-- ai_only_conversations: never had a single staff-sent message, i.e. the AI
-- ran the entire conversation start to finish on its own.
-- kain_pasang_* columns rely on sent_design_codes/chosen_design_code/
-- payment_method_chosen, which today are only ever set by the Kain Pasang
-- (design-catalog) flow -- see src/routes/webhook.ts.
create or replace function get_lead_funnel_stats()
returns table (
  total_conversations bigint,
  ai_only_conversations bigint,
  staff_handled_conversations bigint,
  leads_logged bigint,
  purchased bigint,
  not_purchased bigint,
  kain_pasang_designs_shown bigint,
  kain_pasang_design_chosen bigint,
  kain_pasang_payment_sent bigint
)
language sql
stable
as $$
  select
    (select count(*) from conversations),
    (select count(*) from conversations c
       where not exists (select 1 from messages m where m.conversation_id = c.id and m.sender = 'staff')),
    (select count(distinct conversation_id) from messages where sender = 'staff'),
    (select count(*) from conversations where lead_logged_to_sheets = true),
    (select count(*) from conversations where sale_outcome = 'purchased'),
    (select count(*) from conversations where sale_outcome = 'not_purchased'),
    (select count(*) from conversations where coalesce(array_length(sent_design_codes, 1), 0) > 0),
    (select count(*) from conversations where chosen_design_code is not null),
    (select count(*) from conversations where payment_method_chosen is not null);
$$;

grant execute on function get_lead_funnel_stats() to authenticated;
