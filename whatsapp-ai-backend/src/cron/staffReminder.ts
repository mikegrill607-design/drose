import cron from 'node-cron';
import { Sentry } from '../lib/sentry';
import { supabase } from '../lib/supabase';
import { notifyStaff } from '../lib/staffNotify';
import { Conversation } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_THRESHOLD_MS = 2 * DAY_MS;

// One nudge per untouched handoff (staff_reminder_sent gets reset to false
// on any new customer message or staff action -- see webhook.ts/staff.ts),
// not a repeating nag every cron tick.
async function remindConversation(conversation: Conversation): Promise<void> {
  const { data: staff } = await supabase.from('staff').select('whatsapp_number');
  const notice =
    `Reminder: ${conversation.customer_name ?? conversation.customer_phone} ` +
    `(${conversation.customer_phone}) has been waiting ${
      conversation.status === 'awaiting_staff' ? 'for a reply' : 'on you'
    } for 2+ days. Reply, or hand back to AI from the dashboard.`;

  for (const s of staff ?? []) {
    if (s.whatsapp_number && !s.whatsapp_number.startsWith('TODO')) {
      // This fires after 2 full days of silence, so the staff member's own
      // 24h session with the bot has almost always already closed --
      // relies on the fallback template far more often than the immediate
      // handoff notification does.
      await notifyStaff(s.whatsapp_number, {
        freeText: notice,
        templateSettingKey: 'staff_reminder_template',
        templateParams: [conversation.customer_name ?? conversation.customer_phone, conversation.customer_phone],
        kind: 'reminder',
        conversationId: conversation.id,
      });
    }
  }

  await supabase.from('conversations').update({ staff_reminder_sent: true }).eq('id', conversation.id);
}

async function runStaffReminderSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - REMINDER_THRESHOLD_MS).toISOString();

  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('*')
    .in('status', ['awaiting_staff', 'staff_handling'])
    .eq('staff_reminder_sent', false)
    .not('last_ai_or_staff_message_at', 'is', null)
    .lte('last_ai_or_staff_message_at', cutoff);

  if (error) {
    console.error('staff reminder sweep query failed', error);
    return;
  }

  for (const conversation of conversations ?? []) {
    try {
      await remindConversation(conversation as Conversation);
    } catch (err) {
      console.error('staff reminder failed for', conversation.id, err);
      Sentry.captureException(err);
    }
  }
}

export function startStaffReminderCron(): void {
  // Every 6 hours -- frequent enough to catch the 2-day threshold promptly
  // without needing anything more granular than the follow-up cron's own cadence.
  cron.schedule('0 */6 * * *', () => {
    runStaffReminderSweep().catch((err) => {
      console.error('staff reminder sweep crashed', err);
      Sentry.captureException(err);
    });
  });
}
