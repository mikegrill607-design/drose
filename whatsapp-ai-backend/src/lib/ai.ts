import OpenAI from 'openai';
import { supabase } from './supabase';
import { getAppSettings } from './appSettings';
import { selectRelevantKb } from './kbRouter';
import { KnowledgeBaseEntry, Message } from '../types';

const HISTORY_LIMIT = 20;

// Groq exposes an OpenAI-compatible endpoint, so both providers can share the
// same client -- only the base URL, key, and default model differ. Provider
// + API key are entered by the owner via the dashboard Settings page (stored
// in `app_settings`, same pattern as WhatsApp credentials) so each client can
// bring their own key rather than it being hardcoded per deploy.
//
// Groq deprecated llama-3.3-70b-versatile on 2026-06-17 (full shutdown
// 2026-08-16) -- gpt-oss-120b is Groq's own recommended migration target.
const PROVIDER_DEFAULTS = {
  groq: { baseURL: 'https://api.groq.com/openai/v1', defaultModel: 'openai/gpt-oss-120b' },
  openai: { baseURL: undefined, defaultModel: 'gpt-4o-mini' },
} as const;

type LlmProvider = keyof typeof PROVIDER_DEFAULTS;

async function getLlmClient(): Promise<{ client: OpenAI; model: string }> {
  const settings = await getAppSettings();
  const provider = (settings.llm_provider as LlmProvider) || 'groq';
  const apiKey = settings.llm_api_key;

  if (!apiKey) {
    throw new Error(
      `No LLM API key configured for provider "${provider}" -- set it in the dashboard Settings page`
    );
  }

  const providerConfig = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.groq;
  const model = settings.llm_model || providerConfig.defaultModel;

  return {
    client: new OpenAI({ apiKey, baseURL: providerConfig.baseURL }),
    model,
  };
}

async function getActiveSystemPrompt(): Promise<string> {
  const { data, error } = await supabase
    .from('system_prompt')
    .select('content')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.content ?? 'You are a helpful WhatsApp assistant.';
}

// Only pulls in categories relevant to what the customer's actually been
// saying (see kbRouter.ts) instead of every active KB row on every call --
// matters once there are 10+ products, each answered in full descriptive
// text (spec Section 4).
async function getKnowledgeBaseContext(recentMessages: HistoryMessage[]): Promise<string> {
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('topic, content, keywords')
    .eq('is_active', true);

  if (error) throw error;
  if (!data || data.length === 0) return '';

  const relevant = selectRelevantKb(data as KnowledgeBaseEntry[], recentMessages);
  if (relevant.length === 0) return '';

  const sections = relevant.map((row) => `[${row.topic}]\n${row.content}`);
  return `Knowledge base (only sections relevant to the customer's messages -- may be in Bahasa Melayu, English, or both; translate/answer in the customer's language):\n${sections.join('\n\n')}`;
}

type HistoryMessage = Pick<Message, 'sender' | 'content' | 'media_url'>;

function formatHistory(messages: HistoryMessage[]): string {
  return messages
    .map((m) => {
      const body = m.content || (m.media_url ? '[sent an image]' : '');
      return `${m.sender === 'customer' ? 'Customer' : 'Assistant'}: ${body}`;
    })
    .join('\n');
}

export interface ExtractedAttributes {
  size: string | null;
  sleeve: string | null;
  color: string | null;
  material: string | null;
  // Design-catalog browsing state (kain-pasang style products only) -- see
  // webhook.ts. True if the customer's latest reply indicates they'd like to
  // see more design options instead of picking from what's already shown.
  wantsMoreDesigns: boolean;
  // Which payment method the customer named, in their own words (e.g.
  // "maybank", "bank islam") -- null until they've actually answered the
  // "which payment method" question. Only meaningful once a design code has
  // already been chosen.
  paymentMethod: string | null;
}

const ATTRIBUTES_DELIMITER = '###ATTRIBUTES###';

// Appended to whatever system prompt the owner wrote -- not something they
// edit themselves. Regex-based matching (src/lib/intent.ts) kept missing
// real customer phrasing (typos like "pemdek" for "pendek", word choices
// not in the pattern list, etc.) because it has no actual language
// understanding. The model answering the customer already understands all
// of that fine, so it reports what it understood instead of a second
// system trying to re-derive it from raw text with regex.
const ATTRIBUTE_EXTRACTION_INSTRUCTION = `
---
After writing your reply above, on a new line output exactly "${ATTRIBUTES_DELIMITER}" followed by a single-line JSON object capturing what the CUSTOMER has stated so far in this whole conversation (not just their latest message) for these fields: size, sleeve (short/long), color, material, wantsMoreDesigns, paymentMethod. Use a short value in the customer's own words for each one they've given, or null if not given yet. Interpret typos and casual phrasing normally (e.g. "pemdek" means "pendek"). Only fill a field once they've clearly specified it -- never guess or default one.
wantsMoreDesigns: true only if the customer was just shown some design photos and their latest reply says they don't like these / want to see other options (e.g. "takde lain ke", "show me more", "tak berkenan") -- otherwise false.
paymentMethod: only fill this in if you had just asked the customer which payment method they prefer and their latest reply names one (e.g. "maybank", "bank islam") -- otherwise null.
Example: ${ATTRIBUTES_DELIMITER}\n{"size":"M","sleeve":"short","color":null,"material":null,"wantsMoreDesigns":false,"paymentMethod":null}
This JSON line is read by code and never shown to the customer.`;

function parseCompletion(raw: string): { reply: string; extractedAttributes: ExtractedAttributes | null } {
  const delimiterIdx = raw.indexOf(ATTRIBUTES_DELIMITER);
  if (delimiterIdx === -1) {
    return { reply: raw.trim(), extractedAttributes: null };
  }

  const reply = raw.slice(0, delimiterIdx).trim();
  const jsonPart = raw.slice(delimiterIdx + ATTRIBUTES_DELIMITER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    return {
      reply,
      extractedAttributes: {
        size: parsed.size ?? null,
        sleeve: parsed.sleeve ?? null,
        color: parsed.color ?? null,
        material: parsed.material ?? null,
        wantsMoreDesigns: parsed.wantsMoreDesigns === true,
        paymentMethod: parsed.paymentMethod ?? null,
      },
    };
  } catch {
    // Model didn't format it correctly this time -- caller falls back to
    // regex-based detection (src/lib/intent.ts) rather than crash.
    return { reply, extractedAttributes: null };
  }
}

export interface AiReplyResult {
  reply: string;
  // null if the model's output didn't include a parseable attributes line
  // this time -- caller should fall back to regex-based detection.
  extractedAttributes: ExtractedAttributes | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// conversationId is null for the dashboard's "Test Agent" playground -- same
// prompt/KB/LLM path as real webhook replies, just not tied to a real
// conversation (and never sent over WhatsApp; see routes/staff.ts test-ai).
export async function generateAiReply(
  conversationId: string | null,
  recentMessages: HistoryMessage[]
): Promise<AiReplyResult> {
  const [{ client, model }, systemPrompt, kbContext] = await Promise.all([
    getLlmClient(),
    getActiveSystemPrompt(),
    getKnowledgeBaseContext(recentMessages),
  ]);

  const history = formatHistory(recentMessages.slice(-HISTORY_LIMIT));

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: `${systemPrompt}\n\n${kbContext}${ATTRIBUTE_EXTRACTION_INSTRUCTION}` },
      { role: 'user', content: history },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  const { reply, extractedAttributes } = parseCompletion(raw);
  const usage = completion.usage;

  const result: AiReplyResult = {
    reply,
    extractedAttributes,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };

  await supabase.from('token_usage').insert({
    conversation_id: conversationId,
    prompt_tokens: result.promptTokens,
    completion_tokens: result.completionTokens,
    total_tokens: result.totalTokens,
    model,
  });

  return result;
}
