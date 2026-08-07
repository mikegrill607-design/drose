import cron from 'node-cron';
import { supabase } from '../lib/supabase';
import { sendWhatsAppMessage } from '../lib/whatsapp';
import { Conversation } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

// TODO: confirm exact follow-up copy with the owner (spec Section 12).
const FOLLOW_UP_COPY: Record<1 | 2 | 3, { ms: string; en: string }> = {
  1: {
    ms: 'Hai! Masih berminat dengan koleksi kami? Kami boleh bantu carikan yang sesuai 😊',
    en: 'Hi! Still interested in our collection? Happy to help you find the right piece 😊',
  },
  2: {
    ms: 'Hai lagi! Jangan lupa koleksi eksklusif kami -- kebanyakan design cuma ada satu helai je.',
    en: "Just checking in! Don't forget our exclusive pieces -- most designs only have one available.",
  },
  3: {
    ms: 'Last reminder ya -- kalau berminat lagi boleh terus mesej kami bila-bila masa 🙏',
    en: 'Last reminder -- feel free to message us anytime if you change your mind 🙏',
  },
};

async function processConversation(conversation: Conversation): Promise<void> {
  if (!conversation.last_customer_message_at) return;

  const daysSince =
    (Date.now() - new Date(conversation.last_customer_message_at).getTime()) / DAY_MS;

  let nextStage: 1 | 2 | 3 | null = null;
  if (conversation.follow_up_stage === 0 && daysSince >= 1) nextStage = 1;
  else if (conversation.follow_up_stage === 1 && daysSince >= 3) nextStage = 2;
  else if (conversation.follow_up_stage === 2 && daysSince >= 7) nextStage = 3;

  if (!nextStage) return;

  const language = conversation.detected_language === 'en' ? 'en' : 'ms';
  const copy = FOLLOW_UP_COPY[nextStage][language];

  await sendWhatsAppMessage(conversation.customer_phone, copy);

  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    sender: 'ai',
    content: copy,
  });

  await supabase.from('follow_up_log').insert({
    conversation_id: conversation.id,
    stage: nextStage,
    message_type: 'auto',
    content: copy,
  });

  await supabase
    .from('conversations')
    .update({
      follow_up_stage: nextStage,
      follow_up_enabled: nextStage === 3 ? false : conversation.follow_up_enabled,
    })
    .eq('id', conversation.id);
}

async function runFollowUpSweep(): Promise<void> {
  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('follow_up_enabled', true)
    .lt('follow_up_stage', 3);

  if (error) {
    console.error('follow-up sweep query failed', error);
    return;
  }

  for (const conversation of conversations ?? []) {
    try {
      await processConversation(conversation as Conversation);
    } catch (err) {
      console.error('follow-up processing failed for', conversation.id, err);
    }
  }
}

export function startFollowUpCron(): void {
  // Hourly, in-process -- no separate paid scheduler tier needed (spec Section 10).
  cron.schedule('0 * * * *', () => {
    runFollowUpSweep().catch((err) => console.error('follow-up sweep crashed', err));
  });
}
