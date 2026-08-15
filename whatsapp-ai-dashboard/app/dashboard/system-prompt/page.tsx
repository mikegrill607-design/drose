'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { backendApi } from '@/lib/api';
import { SystemPromptRow } from '@/lib/types';

export default function SystemPromptPage() {
  const [history, setHistory] = useState<SystemPromptRow[]>([]);
  const [activeContent, setActiveContent] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadHistory() {
    setLoadError(null);
    try {
      const { data, error } = await getSupabaseClient()
        .from('system_prompt')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data as SystemPromptRow[]) ?? [];
      setHistory(rows);
      const active = rows.find((r) => r.is_active);
      if (active) {
        setActiveContent(active.content);
        setDraft(active.content);
      }
    } catch (err) {
      // Never leave the page stuck on "Loading..." -- show what broke instead.
      setLoadError(err instanceof Error ? err.message : 'Failed to load system prompt history');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  const hasUnsavedChanges = useMemo(() => draft !== activeContent, [draft, activeContent]);

  async function handleSave() {
    if (!draft.trim() || !hasUnsavedChanges) return;
    setSaving(true);
    setJustSaved(false);
    try {
      await backendApi.savePrompt(draft.trim());
      await loadHistory();
      setJustSaved(true);
    } finally {
      setSaving(false);
    }
  }

  function revertTo(content: string) {
    setDraft(content);
    setJustSaved(false);
  }

  if (loading) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  if (loadError) {
    return (
      <div className="p-6">
        <p className="mb-2 text-sm text-red-600">Couldn&apos;t load the system prompt: {loadError}</p>
        <p className="mb-4 text-xs text-neutral-500">
          Usually means the backend URL is wrong/unreachable, or your login session expired -- try signing out
          and back in.
        </p>
        <button
          onClick={() => {
            setLoading(true);
            loadHistory();
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
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">System Prompt</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Controls the AI&apos;s tone and instructions. Changes apply to the next reply -- no deploy needed.
      </p>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-500">
            {hasUnsavedChanges ? (
              <span className="inline-flex items-center gap-1.5 text-amber-600">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Matches active version
              </span>
            )}
          </span>
          {activeContent && draft !== activeContent && (
            <button onClick={() => revertTo(activeContent)} className="text-xs text-neutral-400 hover:underline">
              Discard changes
            </button>
          )}
        </div>

        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setJustSaved(false);
          }}
          rows={20}
          className="w-full rounded-md border border-neutral-300 px-3 py-2.5 font-mono text-sm leading-relaxed text-neutral-900"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !hasUnsavedChanges}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save as new version'}
          </button>
          {justSaved && (
            <p className="text-sm text-emerald-700">
              Saved.{' '}
              <Link href="/dashboard/playground" className="font-medium underline">
                Try it in Test Agent →
              </Link>
            </p>
          )}
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Saving creates a new version and deactivates the previous one -- old versions stay below for rollback.
        </p>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-neutral-800">Version history</h2>
      <div className="space-y-2">
        {history.map((row) => {
          const expanded = expandedId === row.id;
          const preview = row.content.length > 160 && !expanded ? `${row.content.slice(0, 160)}…` : row.content;
          return (
            <div
              key={row.id}
              className={`rounded-md border p-3 text-xs ${
                row.is_active ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 bg-white'
              }`}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-2 font-medium text-neutral-700">
                  {new Date(row.created_at).toLocaleString()}
                  {row.is_active && (
                    <span className="rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      ACTIVE
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-3">
                  {row.content.length > 160 && (
                    <button
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                      className="text-neutral-400 hover:underline"
                    >
                      {expanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                  {!row.is_active && (
                    <button onClick={() => revertTo(row.content)} className="text-neutral-500 hover:underline">
                      Load into editor
                    </button>
                  )}
                </div>
              </div>
              <pre className="whitespace-pre-wrap text-neutral-600">{preview}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
