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

interface DayCount {
  day: string;
  conversation_count: number;
}

interface FunnelStats {
  totalConversations: number;
  aiOnlyConversations: number;
  staffHandledConversations: number;
  leadsLogged: number;
  purchased: number;
  notPurchased: number;
  kainPasangDesignsShown: number;
  kainPasangDesignChosen: number;
  kainPasangPaymentSent: number;
}

interface FunnelStatsRow {
  total_conversations: number;
  ai_only_conversations: number;
  staff_handled_conversations: number;
  leads_logged: number;
  purchased: number;
  not_purchased: number;
  kain_pasang_designs_shown: number;
  kain_pasang_design_chosen: number;
  kain_pasang_payment_sent: number;
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

// db/migrations/015_overview_analytics_rpc.sql
async function loadDailyCounts(): Promise<DayCount[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_conversations_by_day', { days_back: 14 });
  if (error) throw error;
  return (data as DayCount[]) ?? [];
}

async function loadFunnelStats(): Promise<FunnelStats> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_lead_funnel_stats').single();
  if (error) throw error;

  const row = data as FunnelStatsRow;
  return {
    totalConversations: row.total_conversations,
    aiOnlyConversations: row.ai_only_conversations,
    staffHandledConversations: row.staff_handled_conversations,
    leadsLogged: row.leads_logged,
    purchased: row.purchased,
    notPurchased: row.not_purchased,
    kainPasangDesignsShown: row.kain_pasang_designs_shown,
    kainPasangDesignChosen: row.kain_pasang_design_chosen,
    kainPasangPaymentSent: row.kain_pasang_payment_sent,
  };
}

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [dailyCounts, setDailyCounts] = useState<DayCount[] | null>(null);
  const [funnel, setFunnel] = useState<FunnelStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function loadAll() {
    setLoadError(null);
    // Previously unhandled -- a failed RPC (e.g. an expired session) left
    // every stat tile blank forever with no error, indistinguishable from
    // "just no data yet".
    loadStats()
      .then(setStats)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load stats'));
    loadDailyCounts()
      .then(setDailyCounts)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load daily counts'));
    loadFunnelStats()
      .then(setFunnel)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load funnel stats'));
  }

  useEffect(() => {
    loadAll();

    // Keep it fresh as new messages/conversations come in, without a full page reload.
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('overview-stats')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, loadAll)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">Overview</h1>
      <p className="mb-6 text-sm text-neutral-500">Welcome back! Here&apos;s what&apos;s happening.</p>

      {loadError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          Couldn&apos;t load some stats: {loadError} -- try signing out and back in, or{' '}
          <button onClick={loadAll} className="underline">
            retry
          </button>
          .
        </div>
      )}

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

      <h2 className="mb-3 mt-8 text-sm font-semibold text-neutral-800">Conversations by day (last 14 days)</h2>
      <DailyChart data={dailyCounts} />

      <h2 className="mb-3 mt-8 text-sm font-semibold text-neutral-800">How the AI handled it</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile
          label="Handled fully by AI"
          value={funnel?.aiOnlyConversations}
          hint="No staff ever sent a message in these"
        />
        <StatTile label="Needed staff" value={funnel?.staffHandledConversations} />
        <StatTile label="Leads logged" value={funnel?.leadsLogged} hint="Sent through to Google Sheets" />
        <StatTile
          label="Marked purchased"
          value={funnel?.purchased}
          hint={
            funnel && funnel.leadsLogged > 0
              ? `${Math.round((funnel.purchased / funnel.leadsLogged) * 100)}% of logged leads`
              : undefined
          }
        />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-neutral-800">Kain Pasang design flow</h2>
      <p className="mb-3 text-xs text-neutral-500">
        How far customers got through the batched-design + payment flow -- shown a design → picked one → QR sent
        (AI handed off to staff to confirm payment).
      </p>
      <FunnelBar
        steps={[
          { label: 'Shown designs', value: funnel?.kainPasangDesignsShown },
          { label: 'Picked a design', value: funnel?.kainPasangDesignChosen },
          { label: 'Payment (QR) sent', value: funnel?.kainPasangPaymentSent },
        ]}
      />
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

function DailyChart({ data }: { data: DayCount[] | null }) {
  if (!data) {
    return <div className="h-40 rounded-lg border border-neutral-200 bg-white" />;
  }

  // Always render all 14 days, even ones with zero conversations, so the
  // chart's x-axis is continuous rather than skipping quiet days.
  const days: { label: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const match = data.find((row) => row.day === key);
    days.push({ label: d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }), count: match?.conversation_count ?? 0 });
  }

  const max = Math.max(1, ...days.map((d) => d.count));

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex h-40 items-end gap-1.5">
        {days.map((d) => (
          <div key={d.label} className="group relative flex flex-1 flex-col items-center justify-end">
            <span className="mb-1 text-[10px] text-neutral-400 opacity-0 group-hover:opacity-100">{d.count}</span>
            <div
              className="w-full rounded-t bg-neutral-900"
              style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? '3px' : '0' }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {days.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[9px] text-neutral-400">
            {i % 2 === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function FunnelBar({ steps }: { steps: { label: string; value: number | undefined }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value ?? 0));

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
      {steps.map((step) => (
        <div key={step.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 text-xs text-neutral-600">{step.label}</span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-neutral-100">
            <div
              className="h-full rounded bg-neutral-900"
              style={{ width: step.value === undefined ? '0%' : `${((step.value ?? 0) / max) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-xs font-medium text-neutral-900">
            {step.value ?? '—'}
          </span>
        </div>
      ))}
    </div>
  );
}
