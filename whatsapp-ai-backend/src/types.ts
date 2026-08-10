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
  lead_logged_to_sheets: boolean;
  sale_outcome: 'purchased' | 'not_purchased' | null;
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
  | 'followup_day7_template_en'
  // Google Apps Script Web App URL -- each qualified lead (handoff trigger)
  // gets POSTed here so it lands as a row in the owner's own Google Sheet.
  // See src/lib/googleSheets.ts.
  | 'google_sheets_webhook_url'
  // Fallback approved templates for staff WhatsApp alerts, used only when
  // free text fails to send (staff has no open 24h session). The 2-day
  // reminder in particular is almost always outside that window by
  // definition, so it needs this far more often than the immediate handoff
  // notification does. See src/lib/staffNotify.ts.
  | 'staff_handoff_template'
  | 'staff_reminder_template';
