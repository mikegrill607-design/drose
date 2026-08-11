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
  sent_design_codes: string[];
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
  keywords: string | null; // comma-separated aliases to widen matching, e.g. "baju,shirt,lelaki"
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

// One row per photo -- a design code (e.g. "MZF A5") typically has 2-3
// photos (full shot + close-up detail), grouped by design_code in the UI.
export interface DesignCatalogEntry {
  id: string;
  design_code: string;
  product_topic: string; // matches KnowledgeBaseEntry.topic
  material: string | null;
  color: string | null;
  image_url: string;
  is_active: boolean;
  created_at: string;
}

export interface StaffRow {
  id: string;
  name: string;
  whatsapp_number: string;
  auth_user_id: string | null;
}

export type TemplateCategory = 'MARKETING' | 'UTILITY';
export type TemplateStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled';

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  header_text: string | null;
  header_example: string | null;
  body_text: string;
  variable_examples: string[] | null;
  footer_text: string | null;
  meta_template_id: string | null;
  status: TemplateStatus;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenUsageRow {
  id: string;
  conversation_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string;
  created_at: string;
}
