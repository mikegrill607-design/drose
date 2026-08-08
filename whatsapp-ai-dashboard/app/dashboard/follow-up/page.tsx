'use client';

import { useEffect, useState } from 'react';
import { backendApi } from '@/lib/api';

const STAGES: { key: string; label: string; hint: string }[] = [
  { key: 'followup_day1', label: 'Day 1', hint: 'Sent 1 day after the customer went quiet.' },
  { key: 'followup_day3', label: 'Day 3', hint: 'Sent 3 days after, if they still haven’t replied.' },
  { key: 'followup_day7', label: 'Day 7', hint: 'Last one -- auto-disables the sequence for that customer after this.' },
];

export default function FollowUpPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  async function load() {
    const data = await backendApi.getFollowUpSettings();
    setSettings(data);
    setDraft(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Follow-Up Messages</h1>
      <p className="mb-6 text-sm text-neutral-500">
        The automatic Day 1 / 3 / 7 sequence, sent to customers who go quiet -- enabled per-conversation from the
        chat view. Sent in whichever language the AI detected for that customer.
      </p>

      <div className="space-y-6">
        {STAGES.map((stage) => (
          <div key={stage.key} className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-neutral-800">{stage.label}</h2>
            <p className="mb-3 text-xs text-neutral-400">{stage.hint}</p>

            <label className="mb-1 block text-xs font-medium text-neutral-600">Bahasa Melayu</label>
            <textarea
              value={draft[`${stage.key}_ms`] ?? ''}
              onChange={(e) => setDraft({ ...draft, [`${stage.key}_ms`]: e.target.value })}
              rows={3}
              className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
            />

            <label className="mb-1 block text-xs font-medium text-neutral-600">English</label>
            <textarea
              value={draft[`${stage.key}_en`] ?? ''}
              onChange={(e) => setDraft({ ...draft, [`${stage.key}_en`]: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
            />
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
