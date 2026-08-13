'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { backendApi } from '@/lib/api';
import { DesignCatalogEntry, KnowledgeBaseEntry } from '@/lib/types';

export default function DesignCatalogPage() {
  const [entries, setEntries] = useState<DesignCatalogEntry[]>([]);
  const [topics, setTopics] = useState<KnowledgeBaseEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [productTopic, setProductTopic] = useState('');
  const [designCode, setDesignCode] = useState('');
  const [material, setMaterial] = useState('');
  const [color, setColor] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [searchCode, setSearchCode] = useState('');

  async function loadAll() {
    const [catalog, kb] = await Promise.all([
      backendApi.getDesignCatalog(),
      getSupabaseClient().from('knowledge_base').select('*').order('topic'),
    ]);
    setEntries(catalog);
    setTopics((kb.data as KnowledgeBaseEntry[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  // One entry per PHOTO -- a design code usually has 2-3 -- so upload each
  // selected file as a separate call sharing the same code/topic/tags, then
  // group them back together for display.
  async function handleUpload() {
    if (!designCode || !productTopic || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files) {
        await backendApi.uploadDesignPhoto({ designCode, productTopic, material, color, file });
      }
      setDesignCode('');
      setMaterial('');
      setColor('');
      setFiles([]);
      await loadAll();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload photo(s)');
    } finally {
      setUploading(false);
    }
  }

  async function handleToggleActive(entry: DesignCatalogEntry) {
    await backendApi.updateDesignCatalogEntry(entry.id, { is_active: !entry.is_active });
    loadAll();
  }

  async function handleDeletePhoto(id: string) {
    if (!confirm('Delete this photo?')) return;
    await backendApi.deleteDesignCatalogEntry(id);
    loadAll();
  }

  async function handleDeleteDesign(designCodeToDelete: string, topic: string) {
    if (!confirm(`Delete design "${designCodeToDelete}" and all its photos?`)) return;
    const toDelete = entries.filter((e) => e.design_code === designCodeToDelete && e.product_topic === topic);
    await Promise.all(toDelete.map((e) => backendApi.deleteDesignCatalogEntry(e.id)));
    loadAll();
  }

  // Group photos by (product_topic, design_code) for display -- mirrors how
  // the webhook groups them when sending to a customer.
  const groups = useMemo(() => {
    const map = new Map<string, DesignCatalogEntry[]>();
    for (const entry of entries) {
      const key = `${entry.product_topic}::${entry.design_code}`;
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    }
    return Array.from(map.entries()).map(([key, photos]) => ({
      key,
      productTopic: photos[0].product_topic,
      designCode: photos[0].design_code,
      material: photos[0].material,
      color: photos[0].color,
      isActive: photos.every((p) => p.is_active),
      photos,
    }));
  }, [entries]);

  const visibleGroups = useMemo(() => {
    const needle = searchCode.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((g) => g.designCode.toLowerCase().includes(needle));
  }, [groups, searchCode]);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Design Catalog</h1>
      <p className="mb-4 text-sm text-neutral-500">
        For products where the AI sends photos itself (like kain pasang) instead of staff sending a catalog
        manually -- once a customer gives material/color, the AI automatically sends matching design photos and
        asks them to pick a code. Only products with photos here get this behavior; everything else (like Kemeja)
        keeps the normal flow where staff send the catalog after handoff.
      </p>

      <div className="mb-6 space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">Add a design</h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <select
            value={productTopic}
            onChange={(e) => setProductTopic(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 sm:col-span-2"
          >
            <option value="">-- choose product (from Knowledge Base) --</option>
            {topics.map((t) => (
              <option key={t.id} value={t.topic}>
                {t.topic}
              </option>
            ))}
          </select>
          <input
            placeholder="Design code (e.g. MZF A5)"
            value={designCode}
            onChange={(e) => setDesignCode(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          <input
            placeholder="Material (optional, e.g. Crepe Silk)"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          <input
            placeholder="Color (optional, e.g. Maroon)"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
            {files.length > 0 ? `${files.length} photo(s) selected` : 'Choose photo(s)'}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="hidden"
            />
          </label>
          <button
            onClick={handleUpload}
            disabled={uploading || !designCode || !productTopic || files.length === 0}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <span className="text-xs text-neutral-400">
            Select all photos for this one design code at once (full shot + close-ups).
          </span>
        </div>
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      </div>

      {!loading && groups.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <input
            placeholder="Search by design code (e.g. SPE A1)"
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            className="w-full max-w-xs rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          {searchCode && (
            <button onClick={() => setSearchCode('')} className="text-xs text-neutral-500 hover:underline">
              Clear
            </button>
          )}
          <span className="text-xs text-neutral-400">
            {visibleGroups.length} of {groups.length} design{groups.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-neutral-500">No designs uploaded yet.</p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-sm text-neutral-500">No designs match &quot;{searchCode}&quot;.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleGroups.map((group) => (
            <div key={group.key} className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">{group.designCode}</p>
                  <p className="text-xs text-neutral-500">{group.productTopic}</p>
                  {(group.material || group.color) && (
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {[group.material, group.color].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <button onClick={() => handleToggleActive(group.photos[0])} title="Toggle active">
                  {group.isActive ? '✅' : '⬜️'}
                </button>
              </div>

              <div className="mb-2 grid grid-cols-3 gap-1.5">
                {group.photos.map((photo) => (
                  <div key={photo.id} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL */}
                    <img
                      src={photo.image_url}
                      alt={group.designCode}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                    <button
                      onClick={() => handleDeletePhoto(photo.id)}
                      className="absolute right-1 top-1 hidden rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white group-hover:block"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => handleDeleteDesign(group.designCode, group.productTopic)}
                className="text-xs text-red-600 hover:underline"
              >
                Delete design ({group.photos.length} photo{group.photos.length > 1 ? 's' : ''})
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
