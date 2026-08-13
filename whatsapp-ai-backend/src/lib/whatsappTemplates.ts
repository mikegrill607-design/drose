import { getAppSettings } from './appSettings';

const GRAPH_API_VERSION = 'v20.0';

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY';
  headerText?: string | null;
  headerExample?: string | null;
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

  const components: Record<string, unknown>[] = [];

  if (input.headerText) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: input.headerText,
      ...(input.headerExample ? { example: { header_text: [input.headerExample] } } : {}),
    });
  }

  components.push({
    type: 'BODY',
    text: input.bodyText,
    ...(input.variableExamples.length > 0
      ? { example: { body_text: [input.variableExamples] } }
      : {}),
  });

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

export interface MetaTemplateSummary {
  metaTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectedReason: string | null;
  headerText: string | null;
  headerExample: string | null;
  bodyText: string;
  variableExamples: string[];
  footerText: string | null;
}

interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][] };
}

function parseComponents(components: MetaTemplateComponent[] | undefined): {
  headerText: string | null;
  headerExample: string | null;
  bodyText: string;
  variableExamples: string[];
  footerText: string | null;
} {
  const header = components?.find((c) => c.type === 'HEADER' && c.format === 'TEXT');
  const body = components?.find((c) => c.type === 'BODY');
  const footer = components?.find((c) => c.type === 'FOOTER');

  return {
    headerText: header?.text ?? null,
    headerExample: header?.example?.header_text?.[0] ?? null,
    bodyText: body?.text ?? '',
    variableExamples: body?.example?.body_text?.[0] ?? [],
    footerText: footer?.text ?? null,
  };
}

// Fetches every template that exists on the WABA in Meta, regardless of
// whether it was created through this dashboard or directly in Meta's
// WhatsApp Manager (which staff sometimes find easier for one-off
// templates) -- so approval status and content stay in sync either way.
// Paginated since a WABA can have many templates.
export async function listMetaTemplates(): Promise<MetaTemplateSummary[]> {
  const settings = await getAppSettings();
  const wabaId = settings.whatsapp_business_account_id;
  const accessToken = settings.whatsapp_access_token;
  if (!wabaId || !accessToken) {
    throw new Error('WhatsApp Business Account ID or Access Token not configured in Settings');
  }

  const results: MetaTemplateSummary[] = [];
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?fields=id,name,language,category,status,rejected_reason,components&limit=100`;

  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = (await res.json()) as {
      data?: {
        id: string;
        name: string;
        language: string;
        category: string;
        status: string;
        rejected_reason?: string;
        components?: MetaTemplateComponent[];
      }[];
      paging?: { next?: string };
      error?: { message: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message || `Failed to fetch templates from Meta (HTTP ${res.status})`);
    }

    for (const t of json.data ?? []) {
      const parsed = parseComponents(t.components);
      results.push({
        metaTemplateId: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        rejectedReason: t.rejected_reason ?? null,
        ...parsed,
      });
    }

    url = json.paging?.next ?? null;
  }

  return results;
}

// Sends an approved template message -- the only way to reach a customer
// outside the 24-hour session window (e.g. Day 1/3/7 follow-ups).
// headerParameter fills the header's own {{1}} if the template has one --
// numbered independently from the body's parameters, per Meta's component
// model, so it's a separate argument rather than part of `parameters`.
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  language: string,
  parameters: string[],
  headerParameter?: string | null
): Promise<string | null> {
  const settings = await getAppSettings();
  const phoneNumberId = settings.whatsapp_phone_number_id;
  const accessToken = settings.whatsapp_access_token;
  if (!phoneNumberId || !accessToken) {
    console.error('WhatsApp credentials not configured in app_settings; skipping template send to', to);
    return null;
  }

  const components: Record<string, unknown>[] = [];
  if (headerParameter) {
    components.push({ type: 'header', parameters: [{ type: 'text', text: headerParameter }] });
  }
  if (parameters.length > 0) {
    components.push({ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) });
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
        ...(components.length > 0 ? { components } : {}),
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
