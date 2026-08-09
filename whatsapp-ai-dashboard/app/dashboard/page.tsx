'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { backendApi } from '@/lib/api';
import { Conversation } from '@/lib/types';

const STATUS_STYLES: Record<Conversation['status'], string> = {
  ai_active: 'bg-emerald-100 text-emerald-800',
  awaiting_staff: 'bg-amber-100 text-amber-800',
  staff_handling: 'bg-blue-100 text-blue-800',
};

const STATUS_LABELS: Record<Conversation['status'], string> = {
  ai_active: 'AI handling',
  awaiting_staff: 'Awaiting staff',
  staff_handling: 'Staff handling',
};

interface Stats {
  messagesReceived: number;
  aiMessagesSent: number;
  staffMessagesSent: number;
  totalTokens: number;
  aiSuccessRate: number | null; // null when there's no data yet
}

async function loadStats(): Promise<Stats> {
  const supabase = getSupabaseClient();

  const [customerCount, aiCount, staffCount, tokenRows, conversationCount, staffHandledConvIds] =
    await Promise.all([
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('sender', 'customer'),
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('sender', 'ai'),
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('sender', 'staff'),
      supabase.from('token_usage').select('total_tokens'),
      supabase.from('conversations').select('*', { count: 'exact', head: true }),
      supabase.from('messages').select('conversation_id').eq('sender', 'staff'),
    ]);

  const totalTokens = (tokenRows.data ?? []).reduce(
    (sum: number, r: { total_tokens: number }) => sum + r.total_tokens,
    0
  );

  const totalConversations = conversationCount.count ?? 0;
  const staffHandledSet = new Set(
    (staffHandledConvIds.data ?? []).map((r: { conversation_id: string }) => r.conversation_id)
  );
  const aiSuccessRate =
    totalConversations === 0 ? null : (totalConversations - staffHandledSet.size) / totalConversations;

  return {
    messagesReceived: customerCount.count ?? 0,
    aiMessagesSent: aiCount.count ?? 0,
    staffMessagesSent: staffCount.count ?? 0,
    totalTokens,
    aiSuccessRate,
  };
}

export default function ConversationListPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busyConvId, setBusyConvId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();

    supabase
      .from('conversations')
      .select('*')
      .order('last_customer_message_at', { ascending: false })
      .then((result: { data: Conversation[] | null }) => {
        setConversations(result.data ?? []);
        setLoading(false);
      });

    loadStats().then(setStats);

    const channel = supabase
      .channel('conversations-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload: { eventType: string; new: Conversation; old: Conversation }) => {
          setConversations((prev) => {
            if (payload.eventType === 'DELETE') {
              return prev.filter((c) => c.id !== (payload.old as Conversation).id);
            }
            const updated = payload.new as Conversation;
            const exists = prev.some((c) => c.id === updated.id);
            const next = exists
              ? prev.map((c) => (c.id === updated.id ? updated : c))
              : [updated, ...prev];
            return next.sort((a, b) =>
              (b.last_customer_message_at ?? '').localeCompare(a.last_customer_message_at ?? '')
            );
          });
        }
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        loadStats().then(setStats);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleTakeOver(id: string) {
    setBusyConvId(id);
    try {
      await backendApi.takeOver(id);
    } finally {
      setBusyConvId(null);
    }
  }

  async function handleHandback(id: string) {
    setBusyConvId(id);
    try {
      await backendApi.handback(id);
    } finally {
      setBusyConvId(null);
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">Conversations</h1>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Messages received" value={stats?.messagesReceived} />
        <StatTile label="AI replies sent" value={stats?.aiMessagesSent} />
        <StatTile label="Staff replies sent" value={stats?.staffMessagesSent} />
        <StatTile label="Tokens consumed" value={stats?.totalTokens} />
        <StatTile
          label="AI self-resolved rate"
          value={stats?.aiSuccessRate == null ? undefined : `${Math.round(stats.aiSuccessRate * 100)}%`}
          hint="Conversations the AI closed out without a staff takeover"
        />
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : conversations.length === 0 ? (
        <p className="text-sm text-neutral-500">No conversations yet.</p>
      ) : (
        <>
          {/* Mobile: cards, no horizontal scroll -- everything needed fits in one glance. */}
          <div className="space-y-2 sm:hidden">
            {conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => router.push(`/dashboard/${c.id}`)}
                className="cursor-pointer rounded-lg border border-neutral-200 bg-white p-3 active:bg-neutral-50"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <span className="font-medium text-neutral-900">{c.customer_name || 'Unknown'}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status]}`}>
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>
                <p className="mb-2 text-xs text-neutral-500">
                  {c.customer_phone} ·{' '}
                  {c.last_customer_message_at ? new Date(c.last_customer_message_at).toLocaleString() : '—'}
                </p>
                {c.status === 'ai_active' ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTakeOver(c.id);
                    }}
                    disabled={busyConvId === c.id}
                    className="w-full rounded-md border border-neutral-400 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                  >
                    Take over
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleHandback(c.id);
                    }}
                    disabled={busyConvId === c.id}
                    className="w-full rounded-md border border-neutral-400 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                  >
                    Hand back to AI
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: full table. */}
          <div className="hidden overflow-x-auto rounded-lg border border-neutral-200 bg-white sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Last message</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/${c.id}`} className="font-medium text-neutral-900 hover:underline">
                        {c.customer_name || 'Unknown'}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-neutral-600">{c.customer_phone}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status]}`}>
                        {STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-neutral-500">
                      {c.last_customer_message_at
                        ? new Date(c.last_customer_message_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {c.status === 'ai_active' ? (
                        <button
                          onClick={() => handleTakeOver(c.id)}
                          disabled={busyConvId === c.id}
                          className="rounded-md border border-neutral-400 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                          title="Jump in yourself -- the AI stops replying to this customer immediately"
                        >
                          Take over
                        </button>
                      ) : (
                        <button
                          onClick={() => handleHandback(c.id)}
                          disabled={busyConvId === c.id}
                          className="rounded-md border border-neutral-400 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                          title="Let the AI resume replying to this customer"
                        >
                          Hand back to AI
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: number | string | undefined; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-neutral-900">
        {value === undefined ? <span className="text-neutral-300">—</span> : value}
      </p>
      {hint && <p className="mt-1 text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
}
