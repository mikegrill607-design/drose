import { supabase } from './supabase';
import { getAppSettings } from './appSettings';
import { sendWhatsAppTextVerbose } from './whatsapp';
import { sendWhatsAppTemplate } from './whatsappTemplates';
import { AppSettingKey } from '../types';

interface StaffAlertInput {
  freeText: string;
  templateSettingKey: Extract<AppSettingKey, 'staff_handoff_template' | 'staff_reminder_template'>;
  // Positional {{1}}, {{2}}, ... values for the fallback template's body.
  templateParams: string[];
  kind: 'handoff' | 'reminder';
  conversationId?: string | null;
}

async function logAlertAttempt(input: {
  to: string;
  conversationId: string | null | undefined;
  kind: string;
  sentVia: 'text' | 'template';
  waMessageId: string | null;
  deliveryError: string | null;
}): Promise<void> {
  const { error } = await supabase.from('staff_alert_log').insert({
    staff_whatsapp_number: input.to,
    conversation_id: input.conversationId ?? null,
    kind: input.kind,
    sent_via: input.sentVia,
    wa_message_id: input.waMessageId,
    // "sent" here means Meta's API accepted it (returned a message ID) --
    // gets overwritten by the real delivered/read/failed outcome once
    // Meta's status webhook reports it (see routes/webhook.ts).
    delivery_status: input.waMessageId ? 'sent' : 'failed',
    delivery_error: input.deliveryError,
  });
  if (error) console.error('Failed to log staff alert attempt', error);
}

// Meta's 24-hour session rule applies to staff numbers too, not just
// customers -- a free-text alert only delivers if that staff member has
// messaged the business number within the last 24 hours. Free text is tried
// first since it works for the common case (an immediate handoff, staff
// likely active recently) without requiring an approved template at all.
// Falls back to an approved template only if that send fails -- which is
// expected to happen far more often for the 2-day reminder, since by
// definition 2 days of silence has usually also closed the staff session.
//
// Every attempt (text and, if it happens, the template fallback) is logged
// to staff_alert_log -- previously nothing was logged anywhere, so there was
// no row for Meta's later delivery-status webhook event to update, making
// "did this actually arrive" unanswerable after the fact.
export async function notifyStaff(to: string, input: StaffAlertInput): Promise<void> {
  const textResult = await sendWhatsAppTextVerbose(to, input.freeText);
  await logAlertAttempt({
    to,
    conversationId: input.conversationId,
    kind: input.kind,
    sentVia: 'text',
    waMessageId: textResult.messageId,
    deliveryError: textResult.ok ? null : textResult.error ?? 'unknown error',
  });
  if (textResult.ok) return;

  const settings = await getAppSettings();
  const templateName = settings[input.templateSettingKey];
  if (!templateName) {
    console.warn(
      `Free-text staff alert to ${to} failed and no fallback template ("${input.templateSettingKey}") is configured in Settings`
    );
    return;
  }

  const { data: template } = await supabase
    .from('whatsapp_templates')
    .select('name, language, status')
    .eq('name', templateName)
    .eq('status', 'approved')
    .maybeSingle();

  if (!template) {
    console.warn(`Fallback template "${templateName}" not found or not approved; staff alert to ${to} not sent`);
    return;
  }

  const sentViaTemplate = await sendWhatsAppTemplate(to, template.name, template.language, input.templateParams);
  await logAlertAttempt({
    to,
    conversationId: input.conversationId,
    kind: input.kind,
    sentVia: 'template',
    waMessageId: sentViaTemplate,
    deliveryError: sentViaTemplate ? null : 'template send failed -- see Railway logs for HTTP detail',
  });
  if (!sentViaTemplate) {
    console.error(`Fallback template send also failed for staff alert to ${to}`);
  }
}
