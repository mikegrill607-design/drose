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
// messaged the business number within the last 24 hours. Relying on that
// meant staff (or the owner) had to remember to keep messaging the bot just
// to keep alerts flowing, which defeats the point of an alert. So when an
// approved template is configured, it's used FIRST -- template sends work
// regardless of session state, guaranteeing delivery without that chore.
// Free text is only a fallback now (used when no template is configured, or
// if the template send itself fails), not the primary path.
//
// Every attempt (template and, if it happens, the free-text fallback) is
// logged to staff_alert_log -- previously nothing was logged anywhere, so
// there was no row for Meta's later delivery-status webhook event to
// update, making "did this actually arrive" unanswerable after the fact.
export async function notifyStaff(to: string, input: StaffAlertInput): Promise<void> {
  const settings = await getAppSettings();
  const templateName = settings[input.templateSettingKey];

  if (templateName) {
    const { data: template } = await supabase
      .from('whatsapp_templates')
      .select('name, language, status')
      .eq('name', templateName)
      .eq('status', 'approved')
      .maybeSingle();

    if (template) {
      const sentViaTemplate = await sendWhatsAppTemplate(to, template.name, template.language, input.templateParams);
      await logAlertAttempt({
        to,
        conversationId: input.conversationId,
        kind: input.kind,
        sentVia: 'template',
        waMessageId: sentViaTemplate,
        deliveryError: sentViaTemplate ? null : 'template send failed -- see Railway logs for HTTP detail',
      });
      if (sentViaTemplate) return;
      console.error(`Template staff alert to ${to} failed; falling back to free text`);
    } else {
      console.warn(`Configured template "${templateName}" not found or not approved; falling back to free text`);
    }
  }

  const textResult = await sendWhatsAppTextVerbose(to, input.freeText);
  await logAlertAttempt({
    to,
    conversationId: input.conversationId,
    kind: input.kind,
    sentVia: 'text',
    waMessageId: textResult.messageId,
    deliveryError: textResult.ok ? null : textResult.error ?? 'unknown error',
  });
  if (!textResult.ok) {
    console.error(`Free-text staff alert to ${to} also failed -- no template configured or template send failed`);
  }
}

// For low-stakes internal notices (e.g. "a customer wanted a material with
// no designs uploaded") that don't have their own approved template and
// don't need one -- best-effort free text only, unlike notifyStaff's
// guaranteed template-first delivery for real handoffs. Still logged to
// staff_alert_log for the same "did this arrive" visibility.
export async function notifyStaffFreeText(
  to: string,
  freeText: string,
  kind: string,
  conversationId?: string | null
): Promise<void> {
  const textResult = await sendWhatsAppTextVerbose(to, freeText);
  await logAlertAttempt({
    to,
    conversationId,
    kind,
    sentVia: 'text',
    waMessageId: textResult.messageId,
    deliveryError: textResult.ok ? null : textResult.error ?? 'unknown error',
  });
}
