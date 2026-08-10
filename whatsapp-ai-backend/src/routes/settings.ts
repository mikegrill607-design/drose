import { randomBytes } from 'crypto';
import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { invalidateAppSettingsCache } from '../lib/appSettings';
import { sendLeadToGoogleSheets } from '../lib/googleSheets';
import { AppSettingKey } from '../types';

const GOOGLE_KEYS: AppSettingKey[] = ['google_sheets_webhook_url'];

// Fallback approved templates for staff WhatsApp alerts -- see
// src/lib/staffNotify.ts for why these are optional (free text is tried
// first) but strongly recommended for the reminder in particular.
const STAFF_ALERT_TEMPLATE_KEYS: AppSettingKey[] = ['staff_handoff_template', 'staff_reminder_template'];

// Which approved template to use for each Day 1/3/7 stage, per language.
const FOLLOW_UP_TEMPLATE_KEYS: AppSettingKey[] = [
  'followup_day1_template_ms',
  'followup_day1_template_en',
  'followup_day3_template_ms',
  'followup_day3_template_en',
  'followup_day7_template_ms',
  'followup_day7_template_en',
];

export const settingsRouter = Router();

// Editable via the "Update WhatsApp settings" form. whatsapp_verify_token is
// deliberately excluded -- it's system-generated (see ensureVerifyToken)
// rather than typed by a human, so Meta's webhook handshake secret can't be
// weakened to something guessable and never goes out of sync between the DB
// and what's pasted into Meta.
const WHATSAPP_KEYS: AppSettingKey[] = [
  'whatsapp_app_id',
  'whatsapp_business_account_id',
  'whatsapp_phone_number_id',
  'whatsapp_access_token',
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

function generateVerifyToken(): string {
  return `wa_${randomBytes(12).toString('hex')}`;
}

// Called on every GET so a fresh install gets a token without a manual step;
// no-ops once one already exists. Not folded into fetchSettings because only
// the whatsapp settings screen needs this side effect.
async function ensureVerifyToken(): Promise<string> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'whatsapp_verify_token')
    .maybeSingle();
  if (error) throw error;
  if (data?.value) return data.value;

  const token = generateVerifyToken();
  const { error: upsertError } = await supabase
    .from('app_settings')
    .upsert({ key: 'whatsapp_verify_token', value: token, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (upsertError) throw upsertError;
  invalidateAppSettingsCache();
  return token;
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
    const [values, verifyToken] = await Promise.all([fetchSettings(WHATSAPP_KEYS), ensureVerifyToken()]);
    res.json({
      ...values,
      whatsapp_verify_token: verifyToken,
      webhookCallbackUrl: `${(process.env.WEBHOOK_BASE_URL ?? '').trim()}/webhook`,
    });
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

// Lets staff rotate the webhook secret (e.g. if it leaked) without redeploying.
// Meta's app config must be updated with the new value immediately after --
// the old token stops working the moment this returns.
settingsRouter.post('/whatsapp/verify-token/regenerate', async (_req, res) => {
  try {
    const token = generateVerifyToken();
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'whatsapp_verify_token', value: token, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    invalidateAppSettingsCache();
    res.json({ whatsapp_verify_token: token });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to regenerate token' });
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

// Which approved whatsapp_templates.name to send for each Day 1/3/7 stage,
// per language -- these sends always happen outside Meta's 24-hour session
// window, so a template is the only option, never free text.
settingsRouter.get('/followup', async (_req, res) => {
  try {
    const values = await fetchSettings(FOLLOW_UP_TEMPLATE_KEYS);
    res.json(values);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to load settings' });
  }
});

settingsRouter.put('/followup', async (req, res) => {
  const { staffId, ...updates } = req.body ?? {};
  try {
    await upsertSettings(updates, FOLLOW_UP_TEMPLATE_KEYS, staffId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'failed to save settings' });
  }
});

// Google Sheets lead export -- a Google Apps Script Web App URL the owner
// sets up themselves (Settings page has the exact script to paste + deploy
// steps). No Google Cloud project or API key needed on our side.
settingsRouter.get('/google', async (_req, res) => {
  try {
    const values = await fetchSettings(GOOGLE_KEYS);
    res.json(values);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to load settings' });
  }
});

settingsRouter.put('/google', async (req, res) => {
  const { staffId, ...updates } = req.body ?? {};
  try {
    await upsertSettings(updates, GOOGLE_KEYS, staffId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'failed to save settings' });
  }
});

// Lets staff confirm their Apps Script deployment actually works before
// relying on it -- sends one obviously-fake row.
settingsRouter.post('/google/test', async (_req, res) => {
  try {
    await sendLeadToGoogleSheets({
      customerName: 'Test Lead',
      customerPhone: '+60000000000',
      product: 'Test product',
      details: 'This is a test row from Drose Batik Settings',
      lastMessage: 'Test message -- safe to delete this row',
      status: 'Test row',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to send test row' });
  }
});

settingsRouter.get('/staff-alerts', async (_req, res) => {
  try {
    const values = await fetchSettings(STAFF_ALERT_TEMPLATE_KEYS);
    res.json(values);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to load settings' });
  }
});

settingsRouter.put('/staff-alerts', async (req, res) => {
  const { staffId, ...updates } = req.body ?? {};
  try {
    await upsertSettings(updates, STAFF_ALERT_TEMPLATE_KEYS, staffId);
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
