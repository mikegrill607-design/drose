import { getAppSettings } from './appSettings';

const GRAPH_API_VERSION = 'v20.0';

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY';
  bodyText: string;
  variableExamples: string[];
  footerText?: string | null;
}

export interface CreateTemplateResult {
  metaTemplateId: string;
  status: string;
}

// Submits a template to Meta for review -- this is the step that actually
// requires approval before it can be used to message a customer outside the
// 24-hour session window. Returns PENDING status; poll getTemplateStatus
// afterward since Meta reviews asynchronously (no webhook by default).
export async function createMessageTemplate(input: CreateTemplateInput): Promise<CreateTemplateResult> {
  const settings = await getAppSettings();
  const wabaId = settings.whatsapp_business_account_id;
  const accessToken = settings.whatsapp_access_token;
  if (!wabaId || !accessToken) {
    throw new Error('WhatsApp Business Account ID or Access Token not configured in Settings');
  }

  const components: Record<string, unknown>[] = [
    {
      type: 'BODY',
      text: input.bodyText,
      ...(input.variableExamples.length > 0
        ? { example: { body_text: [input.variableExamples] } }
        : {}),
    },
  ];
  if (input.footerText) {
    components.push({ type: 'FOOTER', text: input.footerText });
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    }),
  });

  const json = (await res.json()) as { id?: string; status?: string; error?: { message: string } };
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message || `Meta rejected the template (HTTP ${res.status})`);
  }

  return { metaTemplateId: json.id, status: json.status ?? 'PENDING' };
}

export interface TemplateStatusResult {
  status: string;
  rejectedReason: string | null;
}

// Meta doesn't push approval/rejection via webhook by default, so the status
// cron polls this periodically for any template still marked "pending".
export async function getTemplateStatus(metaTemplateId: string): Promise<TemplateStatusResult> {
  const settings = await getAppSettings();
  const accessToken = settings.whatsapp_access_token;
  if (!accessToken) throw new Error('WhatsApp Access Token not configured in Settings');

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${metaTemplateId}?fields=status,rejected_reason`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const json = (await res.json()) as { status?: string; rejected_reason?: string; error?: { message: string } };
  if (!res.ok) {
    throw new Error(json.error?.message || `Failed to fetch template status (HTTP ${res.status})`);
  }

  return { status: json.status ?? 'PENDING', rejectedReason: json.rejected_reason ?? null };
}

// Sends an approved template message -- the only way to reach a customer
// outside the 24-hour session window (e.g. Day 1/3/7 follow-ups).
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  language: string,
  parameters: string[]
): Promise<string | null> {
  const settings = await getAppSettings();
  const phoneNumberId = settings.whatsapp_phone_number_id;
  const accessToken = settings.whatsapp_access_token;
  if (!phoneNumberId || !accessToken) {
    console.error('WhatsApp credentials not configured in app_settings; skipping template send to', to);
    return null;
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        ...(parameters.length > 0
          ? { components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }] }
          : {}),
      },
    }),
  });

  if (!res.ok) {
    console.error('WhatsApp template send failed', res.status, await res.text());
    return null;
  }

  const json = (await res.json()) as { messages?: { id: string }[] };
  return json.messages?.[0]?.id ?? null;
}
