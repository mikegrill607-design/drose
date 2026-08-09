-- Run this once in the Supabase SQL editor. Collapses the Conversations
-- page's 6 separate stat queries (one of which fetched every token_usage row
-- just to sum it client-side) into a single round trip.
create or replace function get_dashboard_stats()
returns table (
  messages_received bigint,
  ai_messages_sent bigint,
  staff_messages_sent bigint,
  total_tokens bigint,
  total_conversations bigint,
  staff_handled_conversations bigint
)
language sql
stable
as $$
  select
    (select count(*) from messages where sender = 'customer'),
    (select count(*) from messages where sender = 'ai'),
    (select count(*) from messages where sender = 'staff'),
    (select coalesce(sum(total_tokens), 0) from token_usage),
    (select count(*) from conversations),
    (select count(distinct conversation_id) from messages where sender = 'staff');
$$;

-- security invoker (the default) -- runs as the calling staff user, so it
-- relies on the existing "authenticated read" RLS policies on
-- messages/token_usage/conversations rather than bypassing them.
grant execute on function get_dashboard_stats() to authenticated;
