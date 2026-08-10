import { getAppSettings } from './appSettings';

export interface LeadData {
  customerName: string | null;
  customerPhone: string;
  product: string; // '' to leave the existing sheet value untouched on an update
  details: string; // '' to leave the existing sheet value untouched on an update
  lastMessage: string; // '' to leave the existing sheet value untouched on an update
  status: string; // e.g. 'New — chatting' | 'Qualified — handed to staff' | 'Purchased' | 'Not purchased'
}

// POSTs a lead to the owner's Google Apps Script Web App, which upserts it
// as a row in their own Google Sheet (matched by phone number -- see the
// script snippet on the Settings page) so the same customer accumulates one
// row that gets updated over their lifecycle, not a new row per event. No
// Google Cloud project or API key needed on our side -- just a URL, set up
// once via Settings -> Google Sheets. No-ops (not an error) if never
// configured, since this is optional -- the WhatsApp staff notification is
// the primary lead alert.
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
        status: lead.status,
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
