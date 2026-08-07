'use client';

import { useEffect, useState } from 'react';
import { backendApi } from '@/lib/api';
import { StaffRow } from '@/lib/types';

export default function SettingsPage() {
  const [waSettings, setWaSettings] = useState<Record<string, string>>({});
  const [waDraft, setWaDraft] = useState({
    whatsapp_app_id: '',
    whatsapp_business_account_id: '',
    whatsapp_phone_number_id: '',
    whatsapp_access_token: '',
    whatsapp_verify_token: '',
  });
  const [llmSettings, setLlmSettings] = useState<Record<string, string>>({});
  const [llmDraft, setLlmDraft] = useState({
    llm_provider: 'groq',
    llm_api_key: '',
    llm_model: '',
  });
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffNumber, setNewStaffNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingLlm, setSavingLlm] = useState(false);

  async function loadAll() {
    setLoadError(null);
    try {
      const [wa, llm, staffList] = await Promise.all([
        backendApi.getWhatsAppSettings(),
        backendApi.getLlmSettings(),
        backendApi.getStaff(),
      ]);
      setWaSettings(wa);
      setLlmSettings(llm);
      setLlmDraft((prev) => ({ ...prev, llm_provider: llm.llm_provider || 'groq' }));
      setStaff(staffList ?? []);
    } catch (err) {
      // Never leave the page stuck on "Loading..." -- show what broke instead.
      setLoadError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSaveWa() {
    setSaving(true);
    try {
      const updates = Object.fromEntries(Object.entries(waDraft).filter(([, v]) => v));
      if (Object.keys(updates).length === 0) return;
      await backendApi.updateWhatsAppSettings(updates);
      setWaDraft({
        whatsapp_app_id: '',
        whatsapp_business_account_id: '',
        whatsapp_phone_number_id: '',
        whatsapp_access_token: '',
        whatsapp_verify_token: '',
      });
      await loadAll();
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLlm() {
    setSavingLlm(true);
    try {
      const updates = Object.fromEntries(Object.entries(llmDraft).filter(([, v]) => v));
      if (Object.keys(updates).length === 0) return;
      await backendApi.updateLlmSettings(updates);
      setLlmDraft({ llm_provider: llmDraft.llm_provider, llm_api_key: '', llm_model: '' });
      await loadAll();
    } finally {
      setSavingLlm(false);
    }
  }

  async function handleAddStaff() {
    if (!newStaffName || !newStaffNumber) return;
    await backendApi.addStaff(newStaffName, newStaffNumber);
    setNewStaffName('');
    setNewStaffNumber('');
    await loadAll();
  }

  async function handleRemoveStaff(id: string) {
    if (!confirm('Remove this staff member?')) return;
    await backendApi.removeStaff(id);
    await loadAll();
  }

  if (loading) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  if (loadError) {
    return (
      <div className="p-6">
        <p className="mb-2 text-sm text-red-600">Couldn&apos;t load settings: {loadError}</p>
        <p className="mb-4 text-xs text-neutral-500">
          Usually means the backend URL is wrong/unreachable, or your login session expired -- try signing out
          and back in.
        </p>
        <button
          onClick={() => {
            setLoading(true);
            loadAll();
          }}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">Settings</h1>

      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">WhatsApp Business Connection</h2>

        <div className="mb-3 rounded-md bg-neutral-50 p-3 text-xs">
          <p className="font-medium text-neutral-700">Webhook callback URL (paste into Meta app config):</p>
          <code className="break-all text-neutral-600">{waSettings.webhookCallbackUrl || 'Not configured'}</code>
        </div>

        <div className="space-y-3">
          <Field
            label={`App ID ${waSettings.whatsapp_app_id ? `(current: ${waSettings.whatsapp_app_id})` : ''}`}
            value={waDraft.whatsapp_app_id}
            onChange={(v) => setWaDraft({ ...waDraft, whatsapp_app_id: v })}
          />
          <Field
            label={`WhatsApp Business Account ID (WABA) ${waSettings.whatsapp_business_account_id ? `(current: ${waSettings.whatsapp_business_account_id})` : ''}`}
            value={waDraft.whatsapp_business_account_id}
            onChange={(v) => setWaDraft({ ...waDraft, whatsapp_business_account_id: v })}
          />
          <Field
            label={`Phone Number ID ${waSettings.whatsapp_phone_number_id ? `(current: ${waSettings.whatsapp_phone_number_id})` : ''}`}
            value={waDraft.whatsapp_phone_number_id}
            onChange={(v) => setWaDraft({ ...waDraft, whatsapp_phone_number_id: v })}
          />
          <Field
            label={`Access Token ${waSettings.whatsapp_access_token ? `(current: ${waSettings.whatsapp_access_token})` : ''}`}
            value={waDraft.whatsapp_access_token}
            onChange={(v) => setWaDraft({ ...waDraft, whatsapp_access_token: v })}
            type="password"
          />
          <Field
            label="Webhook Verify Token"
            value={waDraft.whatsapp_verify_token}
            onChange={(v) => setWaDraft({ ...waDraft, whatsapp_verify_token: v })}
          />
        </div>

        <button
          onClick={handleSaveWa}
          disabled={saving}
          className="mt-4 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save WhatsApp settings'}
        </button>
      </section>

      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">AI / LLM Provider</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Bring your own API key -- switch between Groq (fast/cheap, default) and OpenAI at any time.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">Provider</label>
            <select
              value={llmDraft.llm_provider}
              onChange={(e) => setLlmDraft({ ...llmDraft, llm_provider: e.target.value })}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
            >
              <option value="groq">Groq (Llama 3.3 70B)</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <Field
            label={`API Key ${llmSettings.llm_api_key ? `(current: ${llmSettings.llm_api_key})` : '(required)'}`}
            value={llmDraft.llm_api_key}
            onChange={(v) => setLlmDraft({ ...llmDraft, llm_api_key: v })}
            type="password"
          />
          <Field
            label={`Model override (optional) ${llmSettings.llm_model ? `(current: ${llmSettings.llm_model})` : ''}`}
            value={llmDraft.llm_model}
            onChange={(v) => setLlmDraft({ ...llmDraft, llm_model: v })}
          />
          <p className="text-xs text-neutral-400">
            Leave the model blank to use the provider default (Groq: llama-3.3-70b-versatile, OpenAI: gpt-4o-mini).
          </p>
        </div>

        <button
          onClick={handleSaveLlm}
          disabled={savingLlm}
          className="mt-4 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {savingLlm ? 'Saving…' : 'Save AI settings'}
        </button>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">Staff (handoff notifications)</h2>

        <div className="mb-3 space-y-2">
          {staff.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2 text-sm">
              <span>
                {s.name} — {s.whatsapp_number}
              </span>
              <button onClick={() => handleRemoveStaff(s.id)} className="text-xs text-red-600 hover:underline">
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            placeholder="Name"
            value={newStaffName}
            onChange={(e) => setNewStaffName(e.target.value)}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          <input
            placeholder="WhatsApp number (e.g. 60123456789)"
            value={newStaffNumber}
            onChange={(e) => setNewStaffNumber(e.target.value)}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          <button
            onClick={handleAddStaff}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
      />
    </div>
  );
}
