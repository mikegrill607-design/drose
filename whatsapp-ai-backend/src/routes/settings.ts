import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { invalidateAppSettingsCache } from '../lib/appSettings';
import { AppSettingKey } from '../types';

export const settingsRouter = Router();

const WHATSAPP_KEYS: AppSettingKey[] = [
  'whatsapp_app_id',
  'whatsapp_business_account_id',
  'whatsapp_phone_number_id',
  'whatsapp_access_token',
  'whatsapp_verify_token',
];

const LLM_KEYS: AppSettingKey[] = ['llm_provider', 'llm_api_key', 'llm_model'];

// Keys whose value should never be echoed back in full (only a trailing hint).
const SECRET_KEYS: AppSettingKey[] = ['whatsapp_access_token', 'llm_api_key'];

async function fetchSettings(keys: AppSettingKey[]): Promise<Partial<Record<AppSettingKey, string>>> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', keys);
  if (error) throw error;

  const values: Partial<Record<AppSettingKey, string>> = {};
  for (const row of data ?? []) {
    const key = row.key as AppSettingKey;
    values[key] = SECRET_KEYS.includes(key) ? `••••••••${row.value.slice(-4)}` : row.value;
  }
  return values;
}

async function upsertSettings(
  updates: Record<string, unknown>,
  allowedKeys: AppSettingKey[],
  staffId?: string
): Promise<void> {
  const entries = Object.entries(updates).filter(([key]) => allowedKeys.includes(key as AppSettingKey));
  if (entries.length === 0) throw new Error('no valid settings keys provided');

  for (const [key, value] of entries) {
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        { key, value, updated_by: staffId ?? null, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    if (error) throw error;
  }
  invalidateAppSettingsCache();
}

// This router is the only place `app_settings` (which holds the WhatsApp
// access token and LLM API key) is read/written from -- it's mounted with
// the service-role Supabase client only, and the dashboard never talks to
// this table directly.
settingsRouter.get('/whatsapp', async (_req, res) => {
  try {
    const values = await fetchSettings(WHATSAPP_KEYS);
    res.json({ ...values, webhookCallbackUrl: `${process.env.WEBHOOK_BASE_URL ?? ''}/webhook` });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to load settings' });
  }
});

settingsRouter.put('/whatsapp', async (req, res) => {
  const { staffId, ...updates } = req.body ?? {};
  try {
    await upsertSettings(updates, WHATSAPP_KEYS, staffId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'failed to save settings' });
  }
});

// LLM provider + API key -- lets each client bring their own Groq or OpenAI
// key instead of it being hardcoded per deploy (spec extension: see src/lib/ai.ts).
settingsRouter.get('/llm', async (_req, res) => {
  try {
    const values = await fetchSettings(LLM_KEYS);
    res.json({ llm_provider: 'groq', ...values });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to load settings' });
  }
});

settingsRouter.put('/llm', async (req, res) => {
  const { staffId, ...updates } = req.body ?? {};
  if (updates.llm_provider && !['groq', 'openai'].includes(updates.llm_provider)) {
    res.status(400).json({ error: 'llm_provider must be "groq" or "openai"' });
    return;
  }
  try {
    await upsertSettings(updates, LLM_KEYS, staffId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'failed to save settings' });
  }
});

settingsRouter.get('/staff', async (_req, res) => {
  const { data, error } = await supabase.from('staff').select('*').order('name');
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

settingsRouter.post('/staff', async (req, res) => {
  const { name, whatsapp_number, auth_user_id } = req.body ?? {};
  if (!name || !whatsapp_number) {
    res.status(400).json({ error: 'name and whatsapp_number are required' });
    return;
  }

  const { data, error } = await supabase
    .from('staff')
    .insert({ name, whatsapp_number, auth_user_id: auth_user_id ?? null })
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

settingsRouter.delete('/staff/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('staff').delete().eq('id', id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});
