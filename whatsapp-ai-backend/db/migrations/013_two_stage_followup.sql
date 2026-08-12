-- Follow-up redesign: 2 stages instead of 3, automatic for every lead by
-- default (no more per-conversation opt-in toggle -- staff can still opt a
-- specific conversation OUT). Stage 2's timing is measured from when stage 1
-- was actually SENT, not from the customer's original last message, so
-- follow_up_last_sent_at is needed (last_ai_or_staff_message_at isn't
-- reliable for this -- it gets touched by staff replies, handoffs, etc).
alter table conversations add column if not exists follow_up_last_sent_at timestamptz;

-- New conversations are follow-up-eligible by default now.
alter table conversations alter column follow_up_enabled set default true;

-- Existing conversations: nothing has actually been sent yet (no templates
-- were ever configured), so it's safe to opt everyone still undecided into
-- the new automatic behavior rather than leave them stuck on the old
-- opt-in default.
update conversations set follow_up_enabled = true where sale_outcome is null;
