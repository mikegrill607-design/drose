'use client';

import { useEffect, useMemo, useState } from 'react';
import { backendApi } from '@/lib/api';
import { TemplateStatus, WhatsAppTemplate } from '@/lib/types';

const STATUS_STYLES: Record<TemplateStatus, string> = {
  draft: 'bg-neutral-100 text-neutral-700',
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  paused: 'bg-neutral-100 text-neutral-700',
  disabled: 'bg-neutral-100 text-neutral-700',
};

function detectPlaceholderCount(body: string): number {
  const matches = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return matches.length > 0 ? Math.max(...matches) : 0;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('ms');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [headerText, setHeaderText] = useState('');
  const [headerExample, setHeaderExample] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [variableExamples, setVariableExamples] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const placeholderCount = useMemo(() => detectPlaceholderCount(bodyText), [bodyText]);
  // Meta allows the header at most one variable, numbered independently
  // from the body's {{1}}{{2}}... -- not "does the header contain {{2}}",
  // just "does it contain {{1}} at all".
  const headerHasVariable = useMemo(() => /\{\{1\}\}/.test(headerText), [headerText]);

  async function load() {
    const data = await backendApi.getTemplates();
    setTemplates(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setName('');
    setHeaderText('');
    setHeaderExample('');
    setBodyText('');
    setFooterText('');
    setVariableExamples([]);
  }

  async function handleCreate() {
    if (!name.trim() || !bodyText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await backendApi.createTemplate({
        name,
        language,
        category,
        headerText: headerText.trim() || undefined,
        headerExample: headerHasVariable ? headerExample.trim() || undefined : undefined,
        bodyText: bodyText.trim(),
        variableExamples: variableExamples.slice(0, placeholderCount),
        footerText: footerText.trim() || undefined,
      });
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await backendApi.submitTemplate(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Meta rejected the submission');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return;
    setBusyId(id);
    try {
      await backendApi.deleteTemplate(id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Message Templates</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Required by Meta to message a customer outside the 24-hour reply window (e.g. Day 1/3/7 follow-ups).
        Save a draft, then submit it for Meta&apos;s review -- approval usually takes minutes to a day.
      </p>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">New template</h2>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. day3_followup"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
            >
              <option value="ms">Bahasa Melayu</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-neutral-600">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as 'MARKETING' | 'UTILITY')}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
          >
            <option value="MARKETING">Marketing (re-engagement, promos)</option>
            <option value="UTILITY">Utility (order/account updates)</option>
          </select>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-neutral-600">
            Header (optional) -- short line above the body, at most one {'{{1}}'} of its own
          </label>
          <input
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            maxLength={60}
            placeholder="e.g. Drose Batik"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          {headerHasVariable && (
            <input
              value={headerExample}
              onChange={(e) => setHeaderExample(e.target.value)}
              placeholder="Example value for the header's {{1}}"
              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400"
            />
          )}
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-neutral-600">
            Body text -- use {'{{1}}'}, {'{{2}}'} for variables
          </label>
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={3}
            placeholder="Hai {{1}}! Masih berminat dengan koleksi kami?"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
        </div>

        {placeholderCount > 0 && (
          <div className="mb-3 space-y-2 rounded-md bg-neutral-50 p-3">
            <p className="text-xs text-neutral-500">Example value for each variable -- Meta requires these to review.</p>
            {Array.from({ length: placeholderCount }, (_, i) => (
              <input
                key={i}
                value={variableExamples[i] ?? ''}
                onChange={(e) => {
                  const next = [...variableExamples];
                  next[i] = e.target.value;
                  setVariableExamples(next);
                }}
                placeholder={`Example for {{${i + 1}}}`}
                className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400"
              />
            ))}
          </div>
        )}

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-neutral-600">Footer (optional)</label>
          <input
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            placeholder="Reply STOP to unsubscribe"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
        </div>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={saving || !name.trim() || !bodyText.trim()}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
      </div>

      <div className="space-y-3">
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-2 flex items-start justify-between">
              <div className="flex items-start gap-2">
                <span className="text-lg">💬</span>
                <div>
                  <p className="font-medium text-neutral-900">{t.name}</p>
                  <p className="text-xs text-neutral-500">
                    {t.category === 'MARKETING' ? 'Marketing' : 'Utility'} ·{' '}
                    {(t.variable_examples?.length ?? 0)} variables · {t.language}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status]}`}>
                  {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                </span>
                <button
                  onClick={() => handleDelete(t.id)}
                  disabled={busyId === t.id}
                  title="Delete template"
                  className="text-red-500 hover:text-red-700 disabled:opacity-40"
                >
                  🗑
                </button>
              </div>
            </div>

            <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
              {t.header_text && <p className="mb-1 font-semibold text-neutral-900">{t.header_text}</p>}
              {t.body_text}
            </div>
            {t.footer_text && <p className="mt-1 text-xs text-neutral-400">{t.footer_text}</p>}

            {t.status === 'draft' && (
              <button
                onClick={() => handleSubmit(t.id)}
                disabled={busyId === t.id}
                className="mt-3 rounded-md border border-neutral-400 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
              >
                {busyId === t.id ? 'Submitting…' : 'Submit for review'}
              </button>
            )}
            {t.status === 'rejected' && t.rejected_reason && (
              <p className="mt-2 text-xs text-red-600">Rejected: {t.rejected_reason}</p>
            )}
          </div>
        ))}
        {templates.length === 0 && <p className="text-sm text-neutral-500">No templates yet.</p>}
      </div>
    </div>
  );
}
