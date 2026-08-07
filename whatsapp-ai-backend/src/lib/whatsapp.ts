import { getAppSettings } from './appSettings';

const GRAPH_API_VERSION = 'v20.0';

/**
 * Sends a plain-text WhatsApp message via the Cloud API. Credentials come
 * from `app_settings` (entered via the dashboard Settings page), not env vars.
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<string | null> {
  const settings = await getAppSettings();
  const phoneNumberId = settings.whatsapp_phone_number_id;
  const accessToken = settings.whatsapp_access_token;

  if (!phoneNumberId || !accessToken) {
    console.error('WhatsApp credentials not configured in app_settings; skipping send to', to);
    return null;
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error('WhatsApp send failed', res.status, body);
    return null;
  }

  const json = (await res.json()) as { messages?: { id: string }[] };
  return json.messages?.[0]?.id ?? null;
}
