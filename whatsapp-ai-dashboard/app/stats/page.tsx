'use client';

import { useEffect, useState } from 'react';
import { backendApi } from '@/lib/api';

interface AiPerformance {
  totalPurchased: number;
  purchasedByAiOnly: number;
  aiCloseRate: number | null;
}

// Deliberately outside app/dashboard/ -- that layout is the only place auth
// is enforced (client-side redirect to /login), so this route is public by
// omission, not by an explicit bypass. Shareable as a plain link.
export default function PublicStatsPage() {
  const [data, setData] = useState<AiPerformance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backendApi
      .getPublicAiPerformance()
      .then(setData)
      .catch(() => setError('Could not load stats right now.'));
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Drose Batik</p>
        <h1 className="mt-1 text-lg font-semibold text-neutral-900">AI Sales Performance</h1>

        {error && <p className="mt-6 text-sm text-red-600">{error}</p>}

        {!error && !data && (
          <p className="mt-6 text-sm text-neutral-400">Loading…</p>
        )}

        {data && (
          <>
            <p className="mt-6 text-5xl font-semibold text-neutral-900">
              {data.aiCloseRate === null ? '—' : `${Math.round(data.aiCloseRate * 100)}%`}
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              of sales were closed by the AI on its own, with no staff message sent
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-6">
              <div>
                <p className="text-xl font-semibold text-neutral-900">{data.totalPurchased}</p>
                <p className="text-xs text-neutral-500">Total sales</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-neutral-900">{data.purchasedByAiOnly}</p>
                <p className="text-xs text-neutral-500">Closed by AI alone</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
