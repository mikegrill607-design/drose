import OpenAI from 'openai';
import { supabase } from './supabase';
import { getAppSettings } from './appSettings';
import { DetectedLanguage, Message } from '../types';

const HISTORY_LIMIT = 20;

// Groq exposes an OpenAI-compatible endpoint, so both providers can share the
// same client -- only the base URL, key, and default model differ. Provider
// + API key are entered by the owner via the dashboard Settings page (stored
// in `app_settings`, same pattern as WhatsApp credentials) so each client can
// bring their own key rather than it being hardcoded per deploy.
const PROVIDER_DEFAULTS = {
  groq: { baseURL: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
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

async function getKnowledgeBaseContext(language: DetectedLanguage): Promise<string> {
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('topic, question, answer_ms, answer_en')
    .eq('is_active', true);

  if (error) throw error;
  if (!data || data.length === 0) return '';

  const lines = data.map((row) => {
    const answer = language === 'ms' ? row.answer_ms : row.answer_en;
    return `[${row.topic}] Q: ${row.question}\nA: ${answer ?? row.answer_ms ?? row.answer_en ?? ''}`;
  });

  return `Knowledge base:\n${lines.join('\n\n')}`;
}

function formatHistory(messages: Message[]): string {
  return messages
    .map((m) => `${m.sender === 'customer' ? 'Customer' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

export interface AiReplyResult {
  reply: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function generateAiReply(
  conversationId: string,
  language: DetectedLanguage,
  recentMessages: Message[]
): Promise<AiReplyResult> {
  const [{ client, model }, systemPrompt, kbContext] = await Promise.all([
    getLlmClient(),
    getActiveSystemPrompt(),
    getKnowledgeBaseContext(language),
  ]);

  const history = formatHistory(recentMessages.slice(-HISTORY_LIMIT));

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: `${systemPrompt}\n\n${kbContext}` },
      { role: 'user', content: history },
    ],
  });

  const reply = completion.choices[0]?.message?.content?.trim() ?? '';
  const usage = completion.usage;

  const result: AiReplyResult = {
    reply,
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
