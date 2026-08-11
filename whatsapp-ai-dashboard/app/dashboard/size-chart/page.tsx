'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { backendApi } from '@/lib/api';
import { KnowledgeBaseEntry, SizeChartImage } from '@/lib/types';

export default function SizeChartPage() {
  const [images, setImages] = useState<SizeChartImage[]>([]);
  const [topics, setTopics] = useState<KnowledgeBaseEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [productTopic, setProductTopic] = useState('');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function loadAll() {
    const [chart, kb] = await Promise.all([
      backendApi.getSizeChartImages(),
      getSupabaseClient().from('knowledge_base').select('*').order('topic'),
    ]);
    setImages(chart);
    setTopics((kb.data as KnowledgeBaseEntry[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleUpload() {
    if (!productTopic || !file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await backendApi.uploadSizeChartImage({ productTopic, label, file });
      setLabel('');
      setFile(null);
      await loadAll();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  }

  async function handleToggleActive(entry: SizeChartImage) {
    await backendApi.updateSizeChartImage(entry.id, { is_active: !entry.is_active });
    loadAll();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this size chart image?')) return;
    await backendApi.deleteSizeChartImage(id);
    loadAll();
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Size Chart Images</h1>
      <p className="mb-4 text-sm text-neutral-500">
        For products with an image here, the AI automatically sends it (once per conversation) as soon as the
        customer shows interest -- so they can check exact measurements while telling the AI their size. This is
        separate from the Design Catalog: no &quot;pick a code&quot; step, just a reference image. Products with no
        image here are unaffected.
      </p>

      <div className="mb-6 space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">Add an image</h2>

        <div className="grid grid-cols-2 gap-3">
          <select
            value={productTopic}
            onChange={(e) => setProductTopic(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
          >
            <option value="">-- choose product (from Knowledge Base) --</option>
            {topics.map((t) => (
              <option key={t.id} value={t.topic}>
                {t.topic}
              </option>
            ))}
          </select>
          <input
            placeholder="Label (optional, e.g. Short Sleeve)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
            {file ? file.name : 'Choose image'}
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
          </label>
          <button
            onClick={handleUpload}
            disabled={uploading || !productTopic || !file}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : images.length === 0 ? (
        <p className="text-sm text-neutral-500">No size chart images uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img) => (
            <div key={img.id} className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">{img.label || 'Size chart'}</p>
                  <p className="text-xs text-neutral-500">{img.product_topic}</p>
                </div>
                <button onClick={() => handleToggleActive(img)} title="Toggle active">
                  {img.is_active ? '✅' : '⬜️'}
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL */}
              <img src={img.image_url} alt={img.label ?? 'Size chart'} className="mb-2 w-full rounded-md object-cover" />
              <button onClick={() => handleDelete(img.id)} className="text-xs text-red-600 hover:underline">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
