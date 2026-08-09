export type ConversationStatus = 'ai_active' | 'awaiting_staff' | 'staff_handling';
export type MessageSender = 'customer' | 'ai' | 'staff';
export type DetectedLanguage = 'ms' | 'en';

export interface Conversation {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  detected_language: DetectedLanguage | null;
  status: ConversationStatus;
  follow_up_enabled: boolean;
  follow_up_stage: number;
  last_customer_message_at: string | null;
  last_ai_or_staff_message_at: string | null;
  staff_reminder_sent: boolean;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender: MessageSender;
  content: string;
  media_url: string | null;
  wa_message_id: string | null;
  tokens_used: number | null;
  created_at: string;
}

export interface KnowledgeBaseEntry {
  id: string;
  topic: string; // category label, e.g. "product_kemeja_daniel_rose" or "shipping"
  content: string; // extracted PDF text (or typed), any language
  keywords: string | null; // comma-separated aliases to widen kbRouter matching
  source_filename: string | null;
  is_active: boolean;
  updated_at: string;
}

export interface SystemPromptRow {
  id: string;
  content: string;
  is_active: boolean;
  updated_by: string | null;
  created_at: string;
}

export interface StaffRow {
  id: string;
  name: string;
  whatsapp_number: string;
  auth_user_id: string | null;
}

export type AppSettingKey =
  | 'whatsapp_app_id'
  | 'whatsapp_business_account_id' // WABA ID
  | 'whatsapp_phone_number_id'
  | 'whatsapp_access_token'
  | 'whatsapp_verify_token'
  | 'llm_provider' // 'groq' | 'openai'
  | 'llm_api_key'
  | 'llm_model' // optional override; defaults per-provider in src/lib/ai.ts
  // Which approved whatsapp_templates.name to send for each automatic
  // follow-up stage, per language -- Day 1/3/7 sends always happen outside
  // Meta's 24-hour session window, so free text isn't an option here, only
  // a pre-approved template. See src/routes/templates.ts.
  | 'followup_day1_template_ms'
  | 'followup_day1_template_en'
  | 'followup_day3_template_ms'
  | 'followup_day3_template_en'
  | 'followup_day7_template_ms'
  | 'followup_day7_template_en';
