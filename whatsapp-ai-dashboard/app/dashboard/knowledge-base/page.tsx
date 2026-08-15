'use client';

import { Fragment, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { backendApi } from '@/lib/api';
import { KnowledgeBaseEntry } from '@/lib/types';

export default function KnowledgeBasePage() {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [keywords, setKeywords] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadEntries() {
    setLoadError(null);
    try {
      const { data, error } = await getSupabaseClient().from('knowledge_base').select('*').order('topic');
      if (error) throw error;
      setEntries((data as KnowledgeBaseEntry[]) ?? []);
    } catch (err) {
      // Never leave the page stuck on "Loading..." -- show what broke instead.
      setLoadError(err instanceof Error ? err.message : 'Failed to load knowledge base');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEntries();
  }, []);

  async function handleUpload() {
    if (!topic || !file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await backendApi.uploadKbDocument(topic, keywords, file);
      setTopic('');
      setKeywords('');
      setFile(null);
      await loadEntries();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload PDF');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this knowledge base document?')) return;
    await backendApi.deleteKbEntry(id);
    loadEntries();
  }

  async function handleToggleActive(entry: KnowledgeBaseEntry) {
    await backendApi.updateKbEntry(entry.id, { is_active: !entry.is_active });
    loadEntries();
  }

  if (loadError) {
    return (
      <div className="p-6">
        <p className="mb-2 text-sm text-red-600">Couldn&apos;t load the knowledge base: {loadError}</p>
        <p className="mb-4 text-xs text-neutral-500">
          Usually means the backend URL is wrong/unreachable, or your login session expired -- try signing out
          and back in.
        </p>
        <button
          onClick={() => {
            setLoading(true);
            loadEntries();
          }}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">Knowledge Base</h1>

      <div className="mb-6 space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">Upload a document</h2>
        <p className="text-xs text-neutral-400">
          One PDF per category (e.g. one product, or shipping/payment/returns info). Uploading again under the
          same category name replaces its content -- the AI only pulls in the category(s) relevant to what the
          customer is actually asking, instead of the whole knowledge base every time.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="Category (e.g. Kemeja Batik Cotton, Shipping)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          <input
            placeholder="Keywords, comma separated (e.g. baju, shirt, lelaki)"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
            {file ? file.name : 'Choose PDF'}
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
          <button
            onClick={handleUpload}
            disabled={uploading || !topic || !file}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Keywords</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Active</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Fragment key={entry.id}>
                  <tr className="border-b border-neutral-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-neutral-900">{entry.topic}</td>
                    <td className="px-4 py-2 text-neutral-500">{entry.keywords || '—'}</td>
                    <td className="px-4 py-2 text-neutral-500">{entry.source_filename || '—'}</td>
                    <td className="px-4 py-2">
                      <button onClick={() => handleToggleActive(entry)}>
                        {entry.is_active ? '✅' : '⬜️'}
                      </button>
                    </td>
                    <td className="px-4 py-2 space-x-3 text-right">
                      <button
                        onClick={() => setExpandedId((current) => (current === entry.id ? null : entry.id))}
                        className="text-xs text-neutral-600 hover:underline"
                      >
                        {expandedId === entry.id ? 'Hide' : 'Preview'}
                      </button>
                      <button onClick={() => handleDelete(entry.id)} className="text-xs text-red-600 hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr className="border-b border-neutral-100 bg-neutral-50">
                      <td colSpan={5} className="whitespace-pre-wrap px-4 py-3 text-xs text-neutral-600">
                        {entry.content}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
