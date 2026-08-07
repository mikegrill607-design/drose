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

/**
 * Sends an image (catalog photo) by public URL -- simpler than the
 * two-step "upload to Meta" media flow, since Meta will just fetch the
 * link directly. The image must already be hosted somewhere publicly
 * reachable (Supabase Storage, in this app's case).
 */
export async function sendWhatsAppImage(
  to: string,
  imageUrl: string,
  caption?: string
): Promise<string | null> {
  const settings = await getAppSettings();
  const phoneNumberId = settings.whatsapp_phone_number_id;
  const accessToken = settings.whatsapp_access_token;

  if (!phoneNumberId || !accessToken) {
    console.error('WhatsApp credentials not configured in app_settings; skipping image send to', to);
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
        type: 'image',
        image: { link: imageUrl, ...(caption ? { caption } : {}) },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error('WhatsApp image send failed', res.status, body);
    return null;
  }

  const json = (await res.json()) as { messages?: { id: string }[] };
  return json.messages?.[0]?.id ?? null;
}

/**
 * Downloads an inbound image a customer sent. WhatsApp media URLs are
 * short-lived and require the same access token to fetch, so this is a
 * two-step Graph API call: resolve the media ID to a temp URL, then fetch it.
 */
export async function downloadWhatsAppMedia(
  mediaId: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const settings = await getAppSettings();
  const accessToken = settings.whatsapp_access_token;
  if (!accessToken) {
    console.error('WhatsApp credentials not configured in app_settings; cannot download media');
    return null;
  }

  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) {
    console.error('Failed to resolve WhatsApp media URL', metaRes.status, await metaRes.text());
    return null;
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) return null;

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!fileRes.ok) {
    console.error('Failed to download WhatsApp media', fileRes.status);
    return null;
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType: meta.mime_type ?? 'application/octet-stream' };
}
