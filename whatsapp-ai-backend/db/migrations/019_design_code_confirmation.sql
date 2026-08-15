-- Run this once in the Supabase SQL editor.
-- Holds a design code the AI guessed from vague customer text (e.g. "yg
-- ini", a bare number) while it waits for a yes/no confirmation, before
-- committing it to chosen_design_code. Swipe-replies and exact/messy code
-- typing skip this entirely -- those are trusted immediately (see
-- src/routes/webhook.ts) since there's no guessing involved.
alter table conversations
  add column if not exists pending_design_code text null;
