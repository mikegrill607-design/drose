'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { TokenUsageRow, Conversation } from '@/lib/types';

// Rough Groq Llama 3.3 70B blended estimate -- verify current pricing before
// quoting a client (spec Section 13 notes rates change).
const RM_PER_1K_TOKENS = 0.01;

function startOfDay(daysAgo: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

export default function UsagePage() {
  const [rows, setRows] = useState<TokenUsageRow[]>([]);
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseClient();
    Promise.all([
      supabase.from('token_usage').select('*').order('created_at', { ascending: false }),
      supabase.from('conversations').select('*'),
    ]).then(([usageRes, convRes]) => {
      setRows((usageRes.data as TokenUsageRow[]) ?? []);
      const map: Record<string, Conversation> = {};
      for (const c of (convRes.data as Conversation[]) ?? []) map[c.id] = c;
      setConversations(map);
      setLoading(false);
    });
  }, []);

  const totals = useMemo(() => {
    const today = startOfDay(0);
    const weekAgo = startOfDay(7);
    const monthAgo = startOfDay(30);

    const sum = (predicate: (r: TokenUsageRow) => boolean) =>
      rows.filter(predicate).reduce((acc, r) => acc + r.total_tokens, 0);

    return {
      today: sum((r) => new Date(r.created_at) >= today),
      week: sum((r) => new Date(r.created_at) >= weekAgo),
      month: sum((r) => new Date(r.created_at) >= monthAgo),
    };
  }, [rows]);

  const perConversation = useMemo(() => {
    const totalsByConv: Record<string, number> = {};
    for (const r of rows) {
      if (!r.conversation_id) continue;
      totalsByConv[r.conversation_id] = (totalsByConv[r.conversation_id] ?? 0) + r.total_tokens;
    }
    return Object.entries(totalsByConv).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  if (loading) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">Usage & Cost</h1>

      <div className="mb-6 grid grid-cols-3 gap-4">
        {(['today', 'week', 'month'] as const).map((period) => (
          <div key={period} className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{period}</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">
              {totals[period].toLocaleString()} <span className="text-sm font-normal text-neutral-500">tokens</span>
            </p>
            <p className="text-xs text-neutral-500">
              ~RM {((totals[period] / 1000) * RM_PER_1K_TOKENS).toFixed(2)} (rough estimate)
            </p>
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-neutral-800">Per-conversation breakdown</h2>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {perConversation.map(([convId, tokens]) => (
              <tr key={convId} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2 text-neutral-900">
                  {conversations[convId]?.customer_name || conversations[convId]?.customer_phone || convId}
                </td>
                <td className="px-4 py-2 text-neutral-600">{tokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
