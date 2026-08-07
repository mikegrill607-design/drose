'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { backendApi } from '@/lib/api';
import { KnowledgeBaseEntry } from '@/lib/types';

const EMPTY_DRAFT = { topic: '', question: '', answer_ms: '', answer_en: '', is_active: true };

export default function KnowledgeBasePage() {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  async function loadEntries() {
    const { data } = await getSupabaseClient().from('knowledge_base').select('*').order('topic');
    setEntries((data as KnowledgeBaseEntry[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadEntries();
  }, []);

  function startEdit(entry: KnowledgeBaseEntry) {
    setEditingId(entry.id);
    setDraft({
      topic: entry.topic,
      question: entry.question,
      answer_ms: entry.answer_ms ?? '',
      answer_en: entry.answer_en ?? '',
      is_active: entry.is_active,
    });
  }

  function resetDraft() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setExtracting(true);
    setExtractError(null);
    try {
      const { text } = await backendApi.extractPdfText(file);
      // Drops the raw extracted text into both answer fields as a starting
      // point -- trim/translate before saving, same as typing it by hand.
      setDraft((prev) => ({
        ...prev,
        answer_ms: prev.answer_ms || text,
        answer_en: prev.answer_en || text,
      }));
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Failed to extract PDF text');
    } finally {
      setExtracting(false);
    }
  }

  async function handleSave() {
    if (!draft.topic || !draft.question) return;
    if (editingId) {
      await backendApi.updateKbEntry(editingId, draft);
    } else {
      await backendApi.createKbEntry(draft);
    }
    resetDraft();
    loadEntries();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this knowledge base entry?')) return;
    await backendApi.deleteKbEntry(id);
    loadEntries();
  }

  async function handleToggleActive(entry: KnowledgeBaseEntry) {
    await backendApi.updateKbEntry(entry.id, {
      topic: entry.topic,
      question: entry.question,
      answer_ms: entry.answer_ms ?? undefined,
      answer_en: entry.answer_en ?? undefined,
      is_active: !entry.is_active,
    });
    loadEntries();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">Knowledge Base</h1>

      <div className="mb-6 space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-800">
            {editingId ? 'Edit entry' : 'New entry'}
          </h2>
          <label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
            {extracting ? 'Extracting…' : 'Upload PDF'}
            <input
              type="file"
              accept="application/pdf"
              onChange={handlePdfUpload}
              disabled={extracting}
              className="hidden"
            />
          </label>
        </div>
        {extractError && <p className="text-xs text-red-600">{extractError}</p>}
        <p className="text-xs text-neutral-400">
          Uploading a PDF drops its extracted text into the answer fields below -- trim and translate before
          saving, same as typing it by hand.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="Topic (e.g. shipping)"
            value={draft.topic}
            onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          <input
            placeholder="Example question"
            value={draft.question}
            onChange={(e) => setDraft({ ...draft, question: e.target.value })}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
        </div>
        <textarea
          placeholder="Answer (Bahasa Melayu)"
          value={draft.answer_ms}
          onChange={(e) => setDraft({ ...draft, answer_ms: e.target.value })}
          rows={3}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
        />
        <textarea
          placeholder="Answer (English)"
          value={draft.answer_en}
          onChange={(e) => setDraft({ ...draft, answer_en: e.target.value })}
          rows={3}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
            />
            Active
          </label>
          <button
            onClick={handleSave}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            {editingId ? 'Save changes' : 'Add entry'}
          </button>
          {editingId && (
            <button onClick={resetDraft} className="text-sm text-neutral-500 hover:underline">
              Cancel
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Topic</th>
                <th className="px-4 py-2 font-medium">Question</th>
                <th className="px-4 py-2 font-medium">Active</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2 font-medium text-neutral-900">{entry.topic}</td>
                  <td className="px-4 py-2 text-neutral-600">{entry.question}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => handleToggleActive(entry)}>
                      {entry.is_active ? '✅' : '⬜️'}
                    </button>
                  </td>
                  <td className="px-4 py-2 space-x-3 text-right">
                    <button onClick={() => startEdit(entry)} className="text-xs text-neutral-600 hover:underline">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(entry.id)} className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
