import cron from 'node-cron';
import { Sentry } from '../lib/sentry';
import { supabase } from '../lib/supabase';
import { sendWhatsAppTemplate } from '../lib/whatsappTemplates';
import { getAppSettings } from '../lib/appSettings';
import { sendLeadToGoogleSheets } from '../lib/googleSheets';
import { AppSettingKey, Conversation } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const STAGE_1_DELAY_MS = 1 * DAY_MS; // from the customer's last message
const STAGE_2_DELAY_MS = 2 * DAY_MS; // from when stage 1 was actually sent

// Which app_settings key holds the approved template name for each stage,
// per language. These sends always happen outside Meta's 24-hour session
// window, so a pre-approved template is required -- free text is rejected
// by Meta at this point, not just discouraged.
const STAGE_TEMPLATE_KEYS: Record<1 | 2, { ms: AppSettingKey; en: AppSettingKey }> = {
  1: { ms: 'followup_stage1_template_ms', en: 'followup_stage1_template_en' },
  2: { ms: 'followup_stage2_template_ms', en: 'followup_stage2_template_en' },
};

async function processConversation(conversation: Conversation): Promise<void> {
  if (!conversation.last_customer_message_at) return;

  const now = Date.now();
  let nextStage: 1 | 2 | null = null;

  if (conversation.follow_up_stage === 0) {
    if (now - new Date(conversation.last_customer_message_at).getTime() >= STAGE_1_DELAY_MS) nextStage = 1;
  } else if (conversation.follow_up_stage === 1) {
    // Measured from when stage 1 was actually sent, not the original
    // message -- a customer who goes quiet, gets stage 1, then stays quiet
    // should get stage 2 exactly 2 days after that stage 1 send, regardless
    // of how long they'd already been quiet before it went out.
    const sentAt = conversation.follow_up_last_sent_at
      ? new Date(conversation.follow_up_last_sent_at).getTime()
      : new Date(conversation.last_customer_message_at).getTime();
    if (now - sentAt >= STAGE_2_DELAY_MS) nextStage = 2;
  }

  if (!nextStage) return;

  const language = conversation.detected_language === 'en' ? 'en' : 'ms';
  const settingKey = STAGE_TEMPLATE_KEYS[nextStage][language];
  const settings = await getAppSettings();
  const templateName = settings[settingKey];

  if (!templateName) {
    console.warn(`No template configured for follow-up stage ${nextStage} (${language}); skipping conversation`, conversation.id);
    return;
  }

  const { data: template, error: templateErr } = await supabase
    .from('whatsapp_templates')
    .select('*')
    .eq('name', templateName)
    .eq('status', 'approved')
    .maybeSingle();

  if (templateErr || !template) {
    console.warn(`Configured template "${templateName}" not found or not approved; skipping conversation`, conversation.id);
    return;
  }

  // Follow-up templates are expected to have at most one variable (the
  // customer's name) -- keeps the mapping from "arbitrary approved
  // template" to "what do we actually fill in" unambiguous.
  const hasVariable = (template.variable_examples ?? []).length > 0;
  const params = hasVariable ? [conversation.customer_name || (language === 'ms' ? 'kawan' : 'there')] : [];
  const renderedContent = hasVariable ? template.body_text.replace('{{1}}', params[0]) : template.body_text;

  const sentId = await sendWhatsAppTemplate(conversation.customer_phone, template.name, template.language, params);
  if (!sentId) {
    console.error(`Failed to send follow-up template "${templateName}" to`, conversation.customer_phone);
    return;
  }

  const nowIso = new Date().toISOString();

  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    sender: 'ai',
    content: renderedContent,
    wa_message_id: sentId,
  });

  await supabase.from('follow_up_log').insert({
    conversation_id: conversation.id,
    stage: nextStage,
    message_type: 'auto',
    content: renderedContent,
  });

  await supabase
    .from('conversations')
    .update({
      follow_up_stage: nextStage,
      follow_up_last_sent_at: nowIso,
      // Stage 2 is the last one -- nothing more to send after this.
      follow_up_enabled: nextStage === 2 ? false : conversation.follow_up_enabled,
    })
    .eq('id', conversation.id);

  // Every send is reflected in the owner's Google Sheet so a lead's status
  // shows exactly where it is in the sequence, not just "New" forever.
  await sendLeadToGoogleSheets({
    customerName: conversation.customer_name,
    customerPhone: conversation.customer_phone,
    product: '',
    details: '',
    lastMessage: '',
    status: nextStage === 1 ? 'Follow-up 1 sent — awaiting reply' : 'Follow-up 2 sent — awaiting reply',
  });
}

async function runFollowUpSweep(): Promise<void> {
  // Only leads who've already shown real interest get chased -- not every
  // one-off "hi" a conversation ever received. lead_logged_to_sheets is
  // already the signal for "this customer showed real interest" (see
  // routes/webhook.ts), reused here rather than inventing a second one.
  // sale_outcome null excludes anyone already marked purchased/not-purchased
  // -- no point following up on a decided deal.
  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('follow_up_enabled', true)
    .eq('lead_logged_to_sheets', true)
    .is('sale_outcome', null)
    .lt('follow_up_stage', 2);

  if (error) {
    console.error('follow-up sweep query failed', error);
    return;
  }

  for (const conversation of conversations ?? []) {
    try {
      await processConversation(conversation as Conversation);
    } catch (err) {
      console.error('follow-up processing failed for', conversation.id, err);
      Sentry.captureException(err);
    }
  }
}

export function startFollowUpCron(): void {
  // Hourly, in-process -- no separate paid scheduler tier needed (spec Section 10).
  cron.schedule('0 * * * *', () => {
    runFollowUpSweep().catch((err) => {
      console.error('follow-up sweep crashed', err);
      Sentry.captureException(err);
    });
  });
}
