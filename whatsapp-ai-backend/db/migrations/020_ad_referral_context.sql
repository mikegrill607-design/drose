-- Run this once in the Supabase SQL editor.
-- Meta attaches a "referral" object (ad headline, description, which ad)
-- to the inbound message when a customer arrives via a Click-to-WhatsApp
-- ad. Stored here so the AI can acknowledge it directly instead of a
-- generic greeting (see src/lib/ai.ts, src/routes/webhook.ts), and so it's
-- available later for anyone wanting to see which ad drove a conversation.
alter table conversations
  add column if not exists ad_referral jsonb null;
