-- Run this once in the Supabase SQL editor. Creating a table and giving it
-- RLS policies does NOT automatically make it push live updates -- it also
-- has to be added to the realtime publication. Without this, every dashboard
-- session only ever sees whatever was in the database at the moment IT
-- loaded the page, never live changes from another device/tab (spec Section
-- 3: "Enable Realtime on conversations and messages" -- this is that step).
alter publication supabase_realtime add table conversations, messages;
