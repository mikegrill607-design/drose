'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabaseClient';
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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">Conversations</h1>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : conversations.length === 0 ? (
        <p className="text-sm text-neutral-500">No conversations yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last message</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
