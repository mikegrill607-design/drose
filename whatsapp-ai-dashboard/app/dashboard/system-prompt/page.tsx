'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { backendApi } from '@/lib/api';
import { SystemPromptRow } from '@/lib/types';

export default function SystemPromptPage() {
  const [history, setHistory] = useState<SystemPromptRow[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadHistory() {
    const { data } = await getSupabaseClient()
      .from('system_prompt')
      .select('*')
      .order('created_at', { ascending: false });
    const rows = (data as SystemPromptRow[]) ?? [];
    setHistory(rows);
    const active = rows.find((r) => r.is_active);
    if (active) setDraft(active.content);
    setLoading(false);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleSave() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await backendApi.savePrompt(draft.trim());
      await loadHistory();
    } finally {
      setSaving(false);
    }
  }

  function revertTo(content: string) {
    setDraft(content);
  }

  if (loading) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">System Prompt</h1>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={12}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-3 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save as new version'}
        </button>
        <p className="mt-2 text-xs text-neutral-500">
          Saving creates a new version and deactivates the previous one -- old versions stay below for rollback.
        </p>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-neutral-800">Version history</h2>
      <div className="space-y-2">
        {history.map((row) => (
          <div
            key={row.id}
            className={`rounded-md border p-3 text-xs ${
              row.is_active ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 bg-white'
            }`}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-neutral-700">
                {new Date(row.created_at).toLocaleString()} {row.is_active && '(active)'}
              </span>
              {!row.is_active && (
                <button onClick={() => revertTo(row.content)} className="text-neutral-500 hover:underline">
                  Load into editor
                </button>
              )}
            </div>
            <pre className="whitespace-pre-wrap text-neutral-600">{row.content}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
