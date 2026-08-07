// Calls the Railway backend for any action that needs to send a WhatsApp
// message or touch WhatsApp/LLM credentials -- the dashboard itself only
// holds the Supabase anon key, never those secrets (spec Section 8b). Every
// call forwards the staff member's Supabase session token so the backend
// can verify who's asking (see src/lib/requireStaffAuth.ts) -- otherwise
// these routes would be wide open to anyone who finds the Railway URL.

import { getSupabaseClient } from './supabaseClient';

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL ?? '';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function backendFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...options?.headers },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Backend request failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

// Separate from backendFetch because multipart/form-data must NOT get a
// manual Content-Type header -- the browser sets the boundary itself.
async function backendUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: formData,
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Backend request failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export const backendApi = {
  sendMessage: (conversationId: string, text: string, staffId?: string) =>
    backendFetch('/staff/send-message', {
      method: 'POST',
      body: JSON.stringify({ conversationId, text, staffId }),
    }),

  takeOver: (conversationId: string) =>
    backendFetch('/staff/take-over', {
      method: 'POST',
      body: JSON.stringify({ conversationId }),
    }),

  handback: (conversationId: string) =>
    backendFetch('/staff/handback', {
      method: 'POST',
      body: JSON.stringify({ conversationId }),
    }),

  toggleFollowUp: (conversationId: string, enabled: boolean) =>
    backendFetch('/staff/follow-up/toggle', {
      method: 'POST',
      body: JSON.stringify({ conversationId, enabled }),
    }),

  sendCustomFollowUp: (conversationId: string, text: string, staffId?: string) =>
    backendFetch('/staff/follow-up/custom', {
      method: 'POST',
      body: JSON.stringify({ conversationId, text, staffId }),
    }),

  testAi: (messages: { sender: 'customer' | 'ai' | 'staff'; content: string }[]) =>
    backendFetch<{ reply: string; language: string; totalTokens: number }>('/staff/test-ai', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }),

  createKbEntry: (entry: {
    topic: string;
    question: string;
    answer_ms?: string;
    answer_en?: string;
    is_active?: boolean;
  }) => backendFetch('/kb', { method: 'POST', body: JSON.stringify(entry) }),

  updateKbEntry: (
    id: string,
    entry: { topic: string; question: string; answer_ms?: string; answer_en?: string; is_active: boolean }
  ) => backendFetch(`/kb/${id}`, { method: 'PUT', body: JSON.stringify(entry) }),

  deleteKbEntry: (id: string) => backendFetch(`/kb/${id}`, { method: 'DELETE' }),

  extractPdfText: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return backendUpload<{ text: string }>('/kb/extract-pdf', formData);
  },

  savePrompt: (content: string, staffId?: string) =>
    backendFetch('/system-prompt', { method: 'POST', body: JSON.stringify({ content, staffId }) }),

  getWhatsAppSettings: () => backendFetch<Record<string, string>>('/settings/whatsapp'),

  updateWhatsAppSettings: (updates: Record<string, string>, staffId?: string) =>
    backendFetch('/settings/whatsapp', {
      method: 'PUT',
      body: JSON.stringify({ ...updates, staffId }),
    }),

  getLlmSettings: () => backendFetch<Record<string, string>>('/settings/llm'),

  updateLlmSettings: (updates: Record<string, string>, staffId?: string) =>
    backendFetch('/settings/llm', {
      method: 'PUT',
      body: JSON.stringify({ ...updates, staffId }),
    }),

  getStaff: () =>
    backendFetch<{ id: string; name: string; whatsapp_number: string; auth_user_id: string | null }[]>(
      '/settings/staff'
    ),

  addStaff: (name: string, whatsapp_number: string) =>
    backendFetch('/settings/staff', {
      method: 'POST',
      body: JSON.stringify({ name, whatsapp_number }),
    }),

  removeStaff: (id: string) => backendFetch(`/settings/staff/${id}`, { method: 'DELETE' }),
};
