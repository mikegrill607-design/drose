import { getAppSettings } from './appSettings';

export interface LeadData {
  customerName: string | null;
  customerPhone: string;
  product: string;
  details: string;
  lastMessage: string;
}

// POSTs a qualified lead to the owner's Google Apps Script Web App, which
// appends it as a row in their own Google Sheet. No Google Cloud project or
// API key needed on our side -- just a URL, set up once via Settings ->
// Google Sheets. No-ops (not an error) if never configured, since this is
// optional -- the WhatsApp staff notification is the primary lead alert.
export async function sendLeadToGoogleSheets(lead: LeadData): Promise<void> {
  const settings = await getAppSettings();
  const webhookUrl = settings.google_sheets_webhook_url;
  if (!webhookUrl) return;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        customerName: lead.customerName ?? '',
        customerPhone: lead.customerPhone,
        product: lead.product,
        details: lead.details,
        lastMessage: lead.lastMessage,
      }),
    });
    if (!res.ok) {
      console.error('Google Sheets lead POST failed', res.status, await res.text());
    }
  } catch (err) {
    // Never let a Sheets outage break the actual handoff -- log and move on.
    console.error('Google Sheets lead POST threw', err);
  }
}
