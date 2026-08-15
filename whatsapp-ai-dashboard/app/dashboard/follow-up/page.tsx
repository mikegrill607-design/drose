'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { backendApi } from '@/lib/api';
import { WhatsAppTemplate } from '@/lib/types';

const STAGES: { key: string; label: string; hint: string }[] = [
  { key: 'followup_stage1_template', label: 'Follow-up 1', hint: 'Sent 1 day after the customer went quiet.' },
  {
    key: 'followup_stage2_template',
    label: 'Follow-up 2',
    hint: 'Last one -- sent 2 days after follow-up 1 went out (if they still haven’t replied), then the sequence ends.',
  },
];

export default function FollowUpPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  async function load() {
    setLoadError(null);
    try {
      const [settingsData, templatesData] = await Promise.all([
        backendApi.getFollowUpSettings(),
        backendApi.getTemplates(),
      ]);
      setSettings(settingsData);
      setDraft(settingsData);
      setTemplates(templatesData);
    } catch (err) {
      // Never leave the page stuck on "Loading..." -- show what broke instead.
      setLoadError(err instanceof Error ? err.message : 'Failed to load follow-up settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const approvedMs = templates.filter((t) => t.status === 'approved' && t.language === 'ms');
  const approvedEn = templates.filter((t) => t.status === 'approved' && t.language === 'en');
  const hasAnyApproved = approvedMs.length > 0 || approvedEn.length > 0;

  const hasUnsavedChanges = STAGES.some(
    (s) => draft[`${s.key}_ms`] !== settings[`${s.key}_ms`] || draft[`${s.key}_en`] !== settings[`${s.key}_en`]
  );

  async function handleSave() {
    setSaving(true);
    setJustSaved(false);
    try {
      await backendApi.updateFollowUpSettings(draft);
      await load();
      setJustSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  if (loadError) {
    return (
      <div className="p-6">
        <p className="mb-2 text-sm text-red-600">Couldn&apos;t load follow-up settings: {loadError}</p>
        <p className="mb-4 text-xs text-neutral-500">
          Usually means the backend URL is wrong/unreachable, or your login session expired -- try signing out
          and back in.
        </p>
        <button
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Follow-Up Messages</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Automatic 2-stage sequence for leads who go quiet -- runs for every conversation that showed real interest
        by default, no need to turn it on per customer. Staff can still switch it off for a specific conversation
        from the chat view. Sent in whichever language the AI detected for that customer, and every send updates
        the lead&apos;s status in your Google Sheet.
      </p>

      {!hasAnyApproved && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No approved templates yet. Follow-up sends happen outside Meta&apos;s 24-hour reply window, so they always
          need a pre-approved template -- free text won&apos;t work here. Create and submit one on the{' '}
          <Link href="/dashboard/templates" className="font-medium underline">
            Templates
          </Link>{' '}
          page first.
        </div>
      )}

      <div className="space-y-6">
        {STAGES.map((stage) => (
          <div key={stage.key} className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-neutral-800">{stage.label}</h2>
            <p className="mb-3 text-xs text-neutral-400">{stage.hint}</p>

            <label className="mb-1 block text-xs font-medium text-neutral-600">Bahasa Melayu template</label>
            <select
              value={draft[`${stage.key}_ms`] ?? ''}
              onChange={(e) => setDraft({ ...draft, [`${stage.key}_ms`]: e.target.value })}
              disabled={approvedMs.length === 0}
              className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              <option value="">{approvedMs.length === 0 ? 'No approved BM templates yet' : '-- choose a template --'}</option>
              {approvedMs.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name} -- {t.body_text.slice(0, 40)}
                  {t.body_text.length > 40 ? '…' : ''}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-neutral-600">English template</label>
            <select
              value={draft[`${stage.key}_en`] ?? ''}
              onChange={(e) => setDraft({ ...draft, [`${stage.key}_en`]: e.target.value })}
              disabled={approvedEn.length === 0}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              <option value="">{approvedEn.length === 0 ? 'No approved English templates yet' : '-- choose a template --'}</option>
              {approvedEn.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name} -- {t.body_text.slice(0, 40)}
                  {t.body_text.length > 40 ? '…' : ''}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !hasUnsavedChanges}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {justSaved && <p className="text-sm text-emerald-700">Saved -- takes effect on the next cron run.</p>}
      </div>
    </div>
  );
}
