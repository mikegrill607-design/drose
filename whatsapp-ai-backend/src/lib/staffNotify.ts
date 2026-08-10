import { supabase } from './supabase';
import { getAppSettings } from './appSettings';
import { sendWhatsAppMessage } from './whatsapp';
import { sendWhatsAppTemplate } from './whatsappTemplates';
import { AppSettingKey } from '../types';

interface StaffAlertInput {
  freeText: string;
  templateSettingKey: Extract<AppSettingKey, 'staff_handoff_template' | 'staff_reminder_template'>;
  // Positional {{1}}, {{2}}, ... values for the fallback template's body.
  templateParams: string[];
}

// Meta's 24-hour session rule applies to staff numbers too, not just
// customers -- a free-text alert only delivers if that staff member has
// messaged the business number within the last 24 hours. Free text is tried
// first since it works for the common case (an immediate handoff, staff
// likely active recently) without requiring an approved template at all.
// Falls back to an approved template only if that send fails -- which is
// expected to happen far more often for the 2-day reminder, since by
// definition 2 days of silence has usually also closed the staff session.
export async function notifyStaff(to: string, input: StaffAlertInput): Promise<void> {
  const sentId = await sendWhatsAppMessage(to, input.freeText);
  if (sentId) return;

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
  if (!sentViaTemplate) {
    console.error(`Fallback template send also failed for staff alert to ${to}`);
  }
}
