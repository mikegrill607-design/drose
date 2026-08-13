-- Run this once in the Supabase SQL editor.
--
-- SECURITY FIX: every "authenticated read" policy below meant "any signed-in
-- Supabase user", not "an actual staff member" -- Postgres RLS's
-- `to authenticated` only checks that a request carries a valid session, it
-- doesn't know anything about this app's own `staff` table. Combined with
-- Supabase Auth allowing email signup by default (independent of this app's
-- login-only dashboard UI, since the public anon key is unavoidably exposed
-- in the frontend bundle), this meant customer conversations (names, phone
-- numbers, full chat history), the system prompt, staff phone numbers, and
-- WhatsApp templates were all directly readable -- bypassing the dashboard
-- and the Railway backend entirely -- by literally anyone who could create a
-- Supabase account for this project, plus any stale/test auth account left
-- over from development.
--
-- Fixed by scoping every one of these policies to rows in `staff` whose
-- auth_user_id matches the requesting session. Pairs with the same fix on
-- the backend API (src/lib/requireStaffAuth.ts), which had the identical gap
-- for every /staff, /kb, /settings, etc. route.
--
-- is_staff() is SECURITY DEFINER so the inner check on `staff` runs without
-- being subject to `staff`'s own RLS policy -- avoids the policy needing to
-- evaluate itself recursively, which is the standard Supabase pattern for
-- "is this user a member of role table X" checks.
create or replace function is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from staff where auth_user_id = auth.uid());
$$;

grant execute on function is_staff() to authenticated;

drop policy if exists "authenticated read conversations" on conversations;
drop policy if exists "authenticated read messages" on messages;
drop policy if exists "authenticated read knowledge_base" on knowledge_base;
drop policy if exists "authenticated read system_prompt" on system_prompt;
drop policy if exists "authenticated read token_usage" on token_usage;
drop policy if exists "authenticated read follow_up_log" on follow_up_log;
drop policy if exists "authenticated read staff" on staff;
drop policy if exists "authenticated read whatsapp_templates" on whatsapp_templates;
drop policy if exists "authenticated read staff_alert_log" on staff_alert_log;
drop policy if exists "authenticated read design_catalog" on design_catalog;
drop policy if exists "authenticated read size_chart_images" on size_chart_images;
drop policy if exists "authenticated read payment_methods" on payment_methods;

create policy "staff read conversations" on conversations for select to authenticated using (is_staff());
create policy "staff read messages" on messages for select to authenticated using (is_staff());
create policy "staff read knowledge_base" on knowledge_base for select to authenticated using (is_staff());
create policy "staff read system_prompt" on system_prompt for select to authenticated using (is_staff());
create policy "staff read token_usage" on token_usage for select to authenticated using (is_staff());
create policy "staff read follow_up_log" on follow_up_log for select to authenticated using (is_staff());
create policy "staff read staff" on staff for select to authenticated using (is_staff());
create policy "staff read whatsapp_templates" on whatsapp_templates for select to authenticated using (is_staff());
create policy "staff read staff_alert_log" on staff_alert_log for select to authenticated using (is_staff());
create policy "staff read design_catalog" on design_catalog for select to authenticated using (is_staff());
create policy "staff read size_chart_images" on size_chart_images for select to authenticated using (is_staff());
create policy "staff read payment_methods" on payment_methods for select to authenticated using (is_staff());
