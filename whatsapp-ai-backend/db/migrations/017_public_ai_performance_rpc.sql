-- Run this once in the Supabase SQL editor.
-- Powers a public, no-login stats page (src/routes/publicStats.ts,
-- app/stats/page.tsx) with a single aggregate number: what share of
-- "purchased" conversations the AI closed entirely on its own, with no
-- staff-sent message at any point. Deliberately returns only two counts --
-- no customer names, phone numbers, or message content -- since this
-- function backs a route with no authentication at all.
create or replace function get_public_ai_performance_stats()
returns table (
  total_purchased bigint,
  purchased_by_ai_only bigint
)
language sql
stable
as $$
  select
    (select count(*) from conversations where sale_outcome = 'purchased'),
    (select count(*) from conversations c
       where c.sale_outcome = 'purchased'
       and not exists (select 1 from messages m where m.conversation_id = c.id and m.sender = 'staff'));
$$;

-- Called only from the Railway backend using the service-role key (see
-- src/lib/supabase.ts) -- not granted to anon/authenticated, so there's no
-- direct-from-browser path to this data, only through the rate-limited
-- public-stats route.
