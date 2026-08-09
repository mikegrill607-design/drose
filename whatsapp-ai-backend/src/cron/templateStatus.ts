import cron from 'node-cron';
import { supabase } from '../lib/supabase';
import { getTemplateStatus } from '../lib/whatsappTemplates';

// Meta reviews templates asynchronously and doesn't push a status-change
// webhook by default, so this polls every pending template's status
// periodically instead. Runs every 30 minutes -- template review usually
// takes minutes to a day, no need for anything more frequent.
async function pollPendingTemplates(): Promise<void> {
  const { data: pending, error } = await supabase
    .from('whatsapp_templates')
    .select('id, meta_template_id')
    .eq('status', 'pending')
    .not('meta_template_id', 'is', null);

  if (error) {
    console.error('template status poll query failed', error);
    return;
  }

  for (const template of pending ?? []) {
    try {
      const result = await getTemplateStatus(template.meta_template_id as string);
      const newStatus = result.status.toLowerCase();
      if (newStatus === 'pending') continue; // no change

      await supabase
        .from('whatsapp_templates')
        .update({
          status: newStatus,
          rejected_reason: result.rejectedReason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', template.id);
    } catch (err) {
      console.error('template status poll failed for', template.id, err);
    }
  }
}

export function startTemplateStatusCron(): void {
  cron.schedule('*/30 * * * *', () => {
    pollPendingTemplates().catch((err) => console.error('template status poll crashed', err));
  });
}
