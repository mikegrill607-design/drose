import cron from 'node-cron';
import { Sentry } from '../lib/sentry';
import { supabase } from '../lib/supabase';
import { sendWhatsAppTemplate } from '../lib/whatsappTemplates';
import { getAppSettings } from '../lib/appSettings';
import { AppSettingKey, Conversation } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

// Which app_settings key holds the approved template name for each stage,
// per language. Day 1/3/7 sends always happen outside Meta's 24-hour
// session window, so a pre-approved template is required -- free text is
// rejected by Meta at this point, not just discouraged.
const STAGE_TEMPLATE_KEYS: Record<1 | 2 | 3, { ms: AppSettingKey; en: AppSettingKey }> = {
  1: { ms: 'followup_day1_template_ms', en: 'followup_day1_template_en' },
  2: { ms: 'followup_day3_template_ms', en: 'followup_day3_template_en' },
  3: { ms: 'followup_day7_template_ms', en: 'followup_day7_template_en' },
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
