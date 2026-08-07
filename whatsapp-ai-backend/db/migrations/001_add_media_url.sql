-- Run this once in the Supabase SQL editor if your `messages` table was
-- created before image sending (catalog photos) was added.
alter table messages add column if not exists media_url text;
