-- Run this once in the Supabase SQL editor. Tracks whether a reminder has
-- already been sent for the current handoff, so cron/staffReminder.ts sends
-- exactly one nudge per untouched handoff, not one every cron tick.
alter table conversations add column if not exists staff_reminder_sent boolean not null default false;
