import cron from 'node-cron';
import { Sentry } from '../lib/sentry';
import { syncTemplatesFromMeta } from '../routes/templates';

// Meta reviews templates asynchronously and doesn't push a status-change
// webhook by default, so this polls the WABA's full template list
// periodically instead. Runs every 30 minutes -- template review usually
// takes minutes to a day, no need for anything more frequent. One list call
// covers every template regardless of whether it was created through this
// dashboard or directly in Meta's WhatsApp Manager (see syncTemplatesFromMeta).
export function startTemplateStatusCron(): void {
  cron.schedule('*/30 * * * *', () => {
    syncTemplatesFromMeta().catch((err) => {
      console.error('template status sync crashed', err);
      Sentry.captureException(err);
    });
  });
}
