import { getAppSettings } from './appSettings';

const GRAPH_API_VERSION = 'v20.0';

// WhatsApp usernames (rolled out June 2026) let a customer hide their phone
// number -- inbound messages then carry a Business-Scoped User ID instead,
// shaped "CC.<id>" (e.g. "MY.1096534252904391"), which is never a valid
// phone number on its own. Sending to one requires "recipient" instead of
// "to" (see https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/).
export const BSUID_PATTERN = /^[A-Za-z]{2}\./;

function recipientFields(to: string): Record<string, string> {
  return BSUID_PATTERN.test(to) ? { recipient_type: 'individual', recipient: to } : { to };
}

export interface SendTextResult {
  ok: boolean;
  messageId: string | null;
  error?: string;
}

// Does the actual send and returns full diagnostic detail -- used directly
// by the Settings "Test" button so a failure reason (Meta's real error, not
// just "didn't arrive") shows up in the dashboard instead of only ever being
// visible in Railway's server logs, which isn't somewhere non-technical
// staff can easily check.
export async function sendWhatsAppTextVerbose(to: string, text: string): Promise<SendTextResult> {
  const settings = await getAppSettings();
  const phoneNumberId = settings.whatsapp_phone_number_id;
  const accessToken = settings.whatsapp_access_token;

  if (!phoneNumberId || !accessToken) {
    return { ok: false, messageId: null, error: 'WhatsApp credentials not configured in Settings' };
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
        ...recipientFields(to),
        type: 'text',
        text: { body: text },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, messageId: null, error: `HTTP ${res.status}: ${body}` };
  }

  const json = (await res.json()) as { messages?: { id: string }[] };
  return { ok: true, messageId: json.messages?.[0]?.id ?? null };
}

/**
 * Sends a plain-text WhatsApp message via the Cloud API. Credentials come
 * from `app_settings` (entered via the dashboard Settings page), not env vars.
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<string | null> {
  const result = await sendWhatsAppTextVerbose(to, text);
  if (!result.ok) {
    console.error('WhatsApp send failed', result.error);
    return null;
  }
  return result.messageId;
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
        ...recipientFields(to),
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
