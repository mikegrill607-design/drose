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

export default function ConversationListPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyConvId, setBusyConvId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    setLoadError(null);

    supabase
      .from('conversations')
      .select('*')
      .order('last_customer_message_at', { ascending: false })
      .then((result: { data: Conversation[] | null; error: { message: string } | null }) => {
        if (result.error) {
          // A failed fetch previously looked identical to "no conversations
          // yet" -- show what actually broke instead of a misleading empty list.
          setLoadError(result.error.message);
          setLoading(false);
          return;
        }
        setConversations(result.data ?? []);
        setLoading(false);
      });

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

  async function handleToggleFollowUp(id: string, enabled: boolean) {
    setBusyConvId(id);
    try {
      await backendApi.toggleFollowUp(id, enabled);
    } finally {
      setBusyConvId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this conversation and its entire message history? This cannot be undone.')) return;
    setBusyConvId(id);
    try {
      await backendApi.deleteConversation(id);
      // Realtime DELETE event also removes it, but don't wait on that round-trip.
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete conversation');
    } finally {
      setBusyConvId(null);
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">Conversations</h1>

      {loadError ? (
        <div>
          <p className="mb-2 text-sm text-red-600">Couldn&apos;t load conversations: {loadError}</p>
          <p className="mb-4 text-xs text-neutral-500">
            Usually means the backend URL is wrong/unreachable, or your login session expired -- try signing out
            and back in.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
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
                <div className="flex gap-1.5">
                  {c.status === 'ai_active' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTakeOver(c.id);
                      }}
                      disabled={busyConvId === c.id}
                      className="flex-1 rounded-md border border-neutral-400 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
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
                      className="flex-1 rounded-md border border-neutral-400 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                    >
                      Hand back to AI
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFollowUp(c.id, !c.follow_up_enabled);
                    }}
                    disabled={busyConvId === c.id}
                    title="Auto follow-up (2-stage, on by default)"
                    className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${
                      c.follow_up_enabled
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-neutral-400 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    🔔
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(c.id);
                    }}
                    disabled={busyConvId === c.id}
                    title="Delete conversation"
                    className="shrink-0 rounded-md border border-neutral-400 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    🗑
                  </button>
                </div>
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
                      <div className="flex justify-end gap-1.5">
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
                        <button
                          onClick={() => handleToggleFollowUp(c.id, !c.follow_up_enabled)}
                          disabled={busyConvId === c.id}
                          title={
                            c.follow_up_enabled
                              ? 'Auto follow-up (2-stage) is ON -- click to turn off'
                              : 'Auto follow-up (2-stage) is OFF -- click to turn on'
                          }
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                            c.follow_up_enabled
                              ? 'border-blue-300 bg-blue-50 text-blue-700'
                              : 'border-neutral-400 text-neutral-700 hover:bg-neutral-100'
                          }`}
                        >
                          🔔 Follow-up
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          disabled={busyConvId === c.id}
                          title="Delete conversation"
                          className="rounded-md border border-neutral-400 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
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
