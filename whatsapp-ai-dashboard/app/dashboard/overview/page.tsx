'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';

interface Stats {
  messagesReceived: number;
  aiMessagesSent: number;
  staffMessagesSent: number;
  totalTokens: number;
  totalConversations: number;
  aiSuccessRate: number | null; // null when there's no data yet
}

interface DashboardStatsRow {
  messages_received: number;
  ai_messages_sent: number;
  staff_messages_sent: number;
  total_tokens: number;
  total_conversations: number;
  staff_handled_conversations: number;
}

// Single round trip (db/migrations/003_dashboard_stats_rpc.sql).
async function loadStats(): Promise<Stats> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_dashboard_stats').single();
  if (error) throw error;

  const row = data as DashboardStatsRow;
  const aiSuccessRate =
    row.total_conversations === 0
      ? null
      : (row.total_conversations - row.staff_handled_conversations) / row.total_conversations;

  return {
    messagesReceived: row.messages_received,
    aiMessagesSent: row.ai_messages_sent,
    staffMessagesSent: row.staff_messages_sent,
    totalTokens: row.total_tokens,
    totalConversations: row.total_conversations,
    aiSuccessRate,
  };
}

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    loadStats().then(setStats);

    // Keep it fresh as new messages come in, without a full page reload.
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('overview-stats')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        loadStats().then(setStats);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Overview</h1>
      <p className="mb-6 text-sm text-neutral-500">Welcome back! Here&apos;s what&apos;s happening.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile label="Conversations" value={stats?.totalConversations} />
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
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: number | string | undefined; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">
        {value === undefined ? <span className="text-neutral-300">—</span> : value}
      </p>
      {hint && <p className="mt-1 text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
}
