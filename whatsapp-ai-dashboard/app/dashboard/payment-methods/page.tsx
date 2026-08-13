'use client';

import { useEffect, useState } from 'react';
import { backendApi } from '@/lib/api';
import { PaymentMethod } from '@/lib/types';

export default function PaymentMethodsPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const [methodName, setMethodName] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function loadAll() {
    const data = await backendApi.getPaymentMethods();
    setMethods(data);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleUpload() {
    if (!methodName || !file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await backendApi.uploadPaymentMethod({ methodName, accountHolder, accountNumber, file });
      setMethodName('');
      setAccountHolder('');
      setAccountNumber('');
      setFile(null);
      await loadAll();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload payment method');
    } finally {
      setUploading(false);
    }
  }

  async function handleToggleActive(method: PaymentMethod) {
    await backendApi.updatePaymentMethod(method.id, { is_active: !method.is_active });
    loadAll();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this payment method?')) return;
    await backendApi.deletePaymentMethod(id);
    loadAll();
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Payment Methods</h1>
      <p className="mb-4 text-sm text-neutral-500">
        For products where the AI walks customers through picking a design (like Kain Pasang), once they choose
        one, the AI asks which payment method they prefer from this list, then sends the matching QR code
        automatically. Staff no longer need to send payment info manually for these -- they just confirm the
        booking once payment comes in.
      </p>

      <div className="mb-6 space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">Add a payment method</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            placeholder="Method name (e.g. Maybank)"
            value={methodName}
            onChange={(e) => setMethodName(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          <input
            placeholder="Account holder (optional)"
            value={accountHolder}
            onChange={(e) => setAccountHolder(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
          <input
            placeholder="Account number (optional)"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
            {file ? file.name : 'Choose QR code image'}
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
          </label>
          <button
            onClick={handleUpload}
            disabled={uploading || !methodName || !file}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : methods.length === 0 ? (
        <p className="text-sm text-neutral-500">No payment methods added yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {methods.map((method) => (
            <div key={method.id} className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">{method.method_name}</p>
                  {method.account_holder && <p className="text-xs text-neutral-500">{method.account_holder}</p>}
                  {method.account_number && (
                    <p className="text-xs text-neutral-400">{method.account_number}</p>
                  )}
                </div>
                <button onClick={() => handleToggleActive(method)} title="Toggle active">
                  {method.is_active ? '✅' : '⬜️'}
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL */}
              <img
                src={method.image_url}
                alt={method.method_name}
                className="mb-2 w-full rounded-md object-cover"
              />
              <button onClick={() => handleDelete(method.id)} className="text-xs text-red-600 hover:underline">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
