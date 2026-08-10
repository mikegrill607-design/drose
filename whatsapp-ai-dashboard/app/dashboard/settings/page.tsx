'use client';

import { useEffect, useState } from 'react';
import { backendApi } from '@/lib/api';
import { StaffRow } from '@/lib/types';

// Mirrors PROVIDER_DEFAULTS in whatsapp-ai-backend/src/lib/ai.ts -- only used
// to show the owner what model is actually active when they've left the
// override blank; the backend is the source of truth for what's really sent.
const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
};

// Pasted by the owner into Extensions -> Apps Script on their own Google
// Sheet, then deployed as a Web App -- that URL is what goes in the field
// below. Keeps this integration to "paste a URL", no Google Cloud project
// or API key needed.
const APPS_SCRIPT_SNIPPET = `function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  var headers = ['Timestamp', 'Customer Name', 'Phone', 'Product', 'Details', 'Last Message', 'Status'];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  var newRow = [
    data.timestamp,
    data.customerName,
    data.customerPhone,
    data.product,
    data.details,
    data.lastMessage,
    data.status,
  ];

  // One row per customer -- if this phone number already has a row, update
  // it in place instead of adding a new one. Blank incoming fields (e.g. a
  // "mark as purchased" call only sends a new Status) leave that cell as-is
  // rather than wiping out what was already captured.
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var existing = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i][2] === data.customerPhone) {
        var merged = existing[i].map(function (oldValue, col) {
          var incoming = newRow[col];
          return incoming === '' || incoming === null || incoming === undefined ? oldValue : incoming;
        });
        sheet.getRange(i + 2, 1, 1, headers.length).setValues([merged]);
        return ContentService.createTextOutput(JSON.stringify({ ok: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
  }

  sheet.appendRow(newRow);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}`;

export default function SettingsPage() {
  const [waSettings, setWaSettings] = useState<Record<string, string>>({});
  const [waDraft, setWaDraft] = useState({
    whatsapp_app_id: '',
    whatsapp_business_account_id: '',
    whatsapp_phone_number_id: '',
    whatsapp_access_token: '',
  });
  const [regeneratingToken, setRegeneratingToken] = useState(false);
  const [copiedField, setCopiedField] = useState<'url' | 'token' | null>(null);
  const [llmSettings, setLlmSettings] = useState<Record<string, string>>({});
  const [llmDraft, setLlmDraft] = useState({
    llm_provider: 'groq',
    llm_api_key: '',
    llm_model: '',
  });
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffNumber, setNewStaffNumber] = useState('');
  const [googleSettings, setGoogleSettings] = useState<Record<string, string>>({});
  const [googleDraft, setGoogleDraft] = useState('');
  const [savingGoogle, setSavingGoogle] = useState(false);
  const [testingGoogle, setTestingGoogle] = useState(false);
  const [googleTestResult, setGoogleTestResult] = useState<'ok' | 'error' | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingLlm, setSavingLlm] = useState(false);

  async function loadAll() {
    setLoadError(null);
    try {
      const [wa, llm, staffList, google] = await Promise.all([
        backendApi.getWhatsAppSettings(),
        backendApi.getLlmSettings(),
        backendApi.getStaff(),
        backendApi.getGoogleSettings(),
      ]);
      setWaSettings(wa);
      setLlmSettings(llm);
      setLlmDraft((prev) => ({ ...prev, llm_provider: llm.llm_provider || 'groq' }));
      setStaff(staffList ?? []);
      setGoogleSettings(google);
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
      });
      await loadAll();
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy(field: 'url' | 'token', value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1500);
  }

  async function handleRegenerateToken() {
    if (!confirm('Generate a new verify token? The old one stops working immediately -- update Meta right after.')) {
      return;
    }
    setRegeneratingToken(true);
    try {
      await backendApi.regenerateVerifyToken();
      await loadAll();
    } finally {
      setRegeneratingToken(false);
    }
  }

  async function handleSaveLlm() {
    setSavingLlm(true);
    try {
      // The OpenAI model dropdown always shows a resolved value (falls back to
      // gpt-4o-mini for display) even when the user hasn't touched it, so its
      // choice must always be sent explicitly -- otherwise leaving it on the
      // default visual selection silently saves nothing and any previously
      // stored (possibly invalid) override is left in place untouched.
      const resolvedModel =
        llmDraft.llm_provider === 'openai' ? llmDraft.llm_model || 'gpt-4o-mini' : llmDraft.llm_model;
      const updates: Record<string, string> = {
        ...Object.fromEntries(Object.entries(llmDraft).filter(([key, v]) => v && key !== 'llm_model')),
        ...(resolvedModel ? { llm_model: resolvedModel } : {}),
      };
      if (Object.keys(updates).length === 0) return;
      await backendApi.updateLlmSettings(updates);
      setLlmDraft({ llm_provider: llmDraft.llm_provider, llm_api_key: '', llm_model: '' });
      await loadAll();
    } finally {
      setSavingLlm(false);
    }
  }

  async function handleSaveGoogle() {
    if (!googleDraft) return;
    setSavingGoogle(true);
    setGoogleTestResult(null);
    try {
      await backendApi.updateGoogleSettings({ google_sheets_webhook_url: googleDraft });
      setGoogleDraft('');
      await loadAll();
    } finally {
      setSavingGoogle(false);
    }
  }

  async function handleTestGoogle() {
    setTestingGoogle(true);
    setGoogleTestResult(null);
    try {
      await backendApi.testGoogleSheets();
      setGoogleTestResult('ok');
    } catch {
      setGoogleTestResult('error');
    } finally {
      setTestingGoogle(false);
    }
  }

  async function handleCopyScript() {
    await navigator.clipboard.writeText(APPS_SCRIPT_SNIPPET);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 1500);
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

        <p className="mb-3 text-xs text-neutral-500">
          Paste these into Meta Developer Portal → your App → WhatsApp → Configuration → Webhooks.
        </p>

        <div className="mb-3 space-y-2">
          <CopyField
            label="Callback URL"
            value={waSettings.webhookCallbackUrl || 'Not configured'}
            copied={copiedField === 'url'}
            onCopy={() => handleCopy('url', waSettings.webhookCallbackUrl || '')}
          />
          <CopyField
            label="Verify Token"
            value={waSettings.whatsapp_verify_token || 'Loading…'}
            copied={copiedField === 'token'}
            onCopy={() => handleCopy('token', waSettings.whatsapp_verify_token || '')}
          />
          <button
            onClick={handleRegenerateToken}
            disabled={regeneratingToken}
            className="text-xs text-neutral-500 underline hover:text-neutral-700 disabled:opacity-50"
          >
            {regeneratingToken ? 'Regenerating…' : 'Regenerate verify token'}
          </button>
          <p className="text-xs text-neutral-400">
            Generated automatically -- after verifying in Meta, subscribe to the <code>messages</code> webhook field.
          </p>
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
              <option value="groq">Groq (fast/cheap, default)</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <Field
            label={`API Key ${llmSettings.llm_api_key ? `(current: ${llmSettings.llm_api_key})` : '(required)'}`}
            value={llmDraft.llm_api_key}
            onChange={(v) => setLlmDraft({ ...llmDraft, llm_api_key: v })}
            type="password"
          />
          <div className="rounded-md bg-neutral-50 p-3 text-xs">
            <span className="font-medium text-neutral-700">Model actually in use right now: </span>
            <code className="text-neutral-600">
              {llmSettings.llm_model || PROVIDER_DEFAULT_MODELS[llmDraft.llm_provider] || 'provider default'}
            </code>
            {!llmSettings.llm_model && <span className="text-neutral-400"> (provider default, no override set)</span>}
          </div>
          {llmDraft.llm_provider === 'openai' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Model</label>
              <select
                value={llmDraft.llm_model || 'gpt-4o-mini'}
                onChange={(e) => setLlmDraft({ ...llmDraft, llm_model: e.target.value })}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
              >
                <option value="gpt-4o-mini">gpt-4o-mini -- cheaper, proven track record (recommended)</option>
                <option value="gpt-5.4-nano">gpt-5.4-nano -- newer, ~2x pricier on output</option>
              </select>
            </div>
          ) : (
            <Field
              label={`Model override (optional) ${llmSettings.llm_model ? `(current: ${llmSettings.llm_model})` : ''}`}
              value={llmDraft.llm_model}
              onChange={(v) => setLlmDraft({ ...llmDraft, llm_model: v })}
              placeholder={PROVIDER_DEFAULT_MODELS[llmDraft.llm_provider]}
            />
          )}
          <p className="text-xs text-neutral-400">
            {llmDraft.llm_provider === 'openai'
              ? 'gpt-4o-mini is cheaper and better-proven for multilingual replies -- only switch if you want to compare quality.'
              : 'Leave blank to keep using the provider default shown above.'}
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

      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">Google Sheets (Leads)</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Every customer who shows real interest in a product gets one row in your own Google Sheet
          automatically -- even if they never end up buying -- so you can follow up and segment leads later.
          That row updates itself over time: from &quot;New — chatting&quot;, to &quot;Qualified — handed to
          staff&quot; once they give enough detail, to &quot;Purchased&quot; / &quot;Not purchased&quot; once
          staff mark the outcome on the conversation page. No Google account connection needed on our side --
          you paste one URL from your own Google Sheet.
        </p>

        <ol className="mb-3 list-decimal space-y-1.5 pl-4 text-xs text-neutral-600">
          <li>
            Open (or create) the Google Sheet you want leads to land in, then go to{' '}
            <span className="font-medium text-neutral-800">Extensions → Apps Script</span>.
          </li>
          <li>Delete anything in the editor and paste this in its place:</li>
        </ol>

        <div className="mb-3 rounded-md bg-neutral-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-neutral-400">Apps Script code</span>
            <button
              onClick={handleCopyScript}
              className="rounded-md border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800"
            >
              {copiedScript ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto text-[11px] leading-relaxed text-neutral-100">
            <code>{APPS_SCRIPT_SNIPPET}</code>
          </pre>
        </div>

        <ol start={3} className="mb-3 list-decimal space-y-1.5 pl-4 text-xs text-neutral-600">
          <li>
            Click <span className="font-medium text-neutral-800">Deploy → New deployment</span>, choose type{' '}
            <span className="font-medium text-neutral-800">Web app</span>.
          </li>
          <li>
            Set <span className="font-medium text-neutral-800">Execute as: Me</span> and{' '}
            <span className="font-medium text-neutral-800">Who has access: Anyone</span>, then Deploy.
          </li>
          <li>
            Authorize it when Google prompts you (it&apos;s your own script), then copy the{' '}
            <span className="font-medium text-neutral-800">Web app URL</span> it gives you and paste it below.
          </li>
        </ol>

        <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-700">
          Already set this up before? Replace the old script with the version above, then use{' '}
          <span className="font-medium">Deploy → Manage deployments → Edit (pencil) → New version → Deploy</span>{' '}
          so the same URL picks up the change -- no need to reconnect anything here.
        </p>

        <div className="space-y-3">
          <Field
            label={`Apps Script Web App URL ${googleSettings.google_sheets_webhook_url ? `(current: ${googleSettings.google_sheets_webhook_url})` : '(not connected)'}`}
            value={googleDraft}
            onChange={setGoogleDraft}
            placeholder="https://script.google.com/macros/s/.../exec"
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSaveGoogle}
            disabled={savingGoogle || !googleDraft}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {savingGoogle ? 'Saving…' : 'Save Google Sheets URL'}
          </button>
          {googleSettings.google_sheets_webhook_url && (
            <button
              onClick={handleTestGoogle}
              disabled={testingGoogle}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {testingGoogle ? 'Sending test row…' : 'Test connection'}
            </button>
          )}
          {googleTestResult === 'ok' && (
            <span className="text-xs text-green-600">Test row sent -- check your sheet.</span>
          )}
          {googleTestResult === 'error' && (
            <span className="text-xs text-red-600">Test failed -- check the URL and deployment access.</span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">Staff (handoff notifications)</h2>

        <div className="mb-3 space-y-2">
          {staff.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2 text-sm">
              <span className="text-neutral-800">
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

function CopyField({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-md bg-neutral-50 p-3 text-xs">
      <p className="mb-1 font-medium text-neutral-700">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all text-neutral-600">{value}</code>
        <button
          onClick={onCopy}
          className="shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-1 text-neutral-600 hover:bg-neutral-100"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
      />
    </div>
  );
}
