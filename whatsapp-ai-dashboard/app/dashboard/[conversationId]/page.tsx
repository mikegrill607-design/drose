'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { backendApi } from '@/lib/api';
import { Conversation, Message } from '@/lib/types';

const STATUS_LABELS: Record<Conversation['status'], string> = {
  ai_active: 'AI is handling this chat',
  awaiting_staff: 'Awaiting staff -- customer gave qualifying details',
  staff_handling: 'You are handling this chat',
};

export default function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = use(params);
  const router = useRouter();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingImage, setSendingImage] = useState(false);
  const [followUpText, setFollowUpText] = useState('');
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();

    supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single()
      .then((result: { data: Conversation | null }) => setConversation(result.data));

    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .then((result: { data: Message[] | null }) => setMessages(result.data ?? []));

    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload: { new: Message }) => setMessages((prev) => [...prev, payload.new])
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversationId}` },
        (payload: { new: Conversation }) => setConversation(payload.new)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await backendApi.sendMessage(conversationId, draft.trim());
      setDraft('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  async function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setSendingImage(true);
    try {
      await backendApi.sendImage(conversationId, file, draft.trim() || undefined);
      setDraft('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send image');
    } finally {
      setSendingImage(false);
    }
  }

  async function handleTakeOver() {
    await backendApi.takeOver(conversationId);
  }

  async function handleHandback() {
    await backendApi.handback(conversationId);
  }

  async function handleMarkOutcome(outcome: 'purchased' | 'not_purchased' | null) {
    setConversation((prev) => (prev ? { ...prev, sale_outcome: outcome } : prev));
    try {
      await backendApi.markOutcome(conversationId, outcome);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update outcome');
    }
  }

  async function handleCopyPhone() {
    if (!conversation) return;
    await navigator.clipboard.writeText(conversation.customer_phone);
    setPhoneCopied(true);
    setTimeout(() => setPhoneCopied(false), 1500);
  }

  async function handleDelete() {
    if (!confirm('Delete this conversation and its entire message history? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await backendApi.deleteConversation(conversationId);
      router.push('/dashboard');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete conversation');
      setDeleting(false);
    }
  }

  async function handleToggleFollowUp() {
    if (!conversation) return;
    await backendApi.toggleFollowUp(conversationId, !conversation.follow_up_enabled);
  }

  async function handleSendFollowUp() {
    if (!followUpText.trim()) return;
    await backendApi.sendCustomFollowUp(conversationId, followUpText.trim());
    setFollowUpText('');
  }

  if (!conversation) {
    return <div className="p-6 text-sm text-neutral-500">Loading…</div>;
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] sm:h-screen">
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="relative flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-sm font-semibold text-neutral-900">
            {conversation.customer_name || conversation.customer_phone}
          </h1>
          <p className="text-xs text-neutral-500 lg:hidden">{STATUS_LABELS[conversation.status]}</p>
          <p className="hidden text-xs text-neutral-500 lg:block">{conversation.customer_phone}</p>
        </div>

        {/* Desktop: actions live in the sidebar, just a quick-glance status badge here. */}
        <span className="hidden rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 lg:inline">
          {conversation.status}
        </span>

        {/* Mobile: no room for a persistent sidebar, so the same actions live behind one menu button. */}
        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 lg:hidden"
          aria-label="Conversation actions"
        >
          ⋮
        </button>

        {mobileMenuOpen && (
          <div className="absolute right-4 top-full z-10 mt-1 w-64 rounded-md border border-neutral-200 bg-white p-3 shadow-lg lg:hidden">
            <div className="mb-3 flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2 text-xs">
              <span className="text-neutral-600">{conversation.customer_phone}</span>
              <button
                onClick={handleCopyPhone}
                className="shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-1 text-neutral-600 hover:bg-neutral-100"
              >
                {phoneCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {conversation.status === 'ai_active' ? (
              <button
                onClick={() => {
                  handleTakeOver();
                  setMobileMenuOpen(false);
                }}
                className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Take over
              </button>
            ) : (
              <button
                onClick={() => {
                  handleHandback();
                  setMobileMenuOpen(false);
                }}
                className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Pass Back to AI
              </button>
            )}
            <div className="mb-2 border-t border-neutral-100 pt-2">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                Sale outcome
              </p>
              <OutcomeButtons outcome={conversation.sale_outcome} onSet={handleMarkOutcome} />
            </div>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                handleDelete();
              }}
              disabled={deleting}
              className="w-full text-left text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete conversation'}
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === 'customer' ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-md rounded-lg px-3 py-2 text-sm ${
                m.sender === 'customer'
                  ? 'bg-white text-neutral-900 border border-neutral-200'
                  : m.sender === 'staff'
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-900 text-white'
              }`}
            >
              {m.media_url && (
                // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
                <img src={m.media_url} alt="" className="mb-1 max-h-64 rounded-md object-cover" />
              )}
              {m.content && <p>{m.content}</p>}
              <p className="mt-1 text-[10px] opacity-70">
                {m.sender} · {new Date(m.created_at).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-neutral-200 bg-white p-4">
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelected}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sendingImage}
            title="Send a catalog photo"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            {sendingImage ? '…' : '📷'}
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a reply… (or add a caption before attaching a photo)"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={sending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            Send
          </button>
        </div>

        {/* Follow-up scheduling isn't part of the on-the-go mobile workflow
            (monitor chats + send catalog photos) -- desktop only. */}
        <div className="mt-3 hidden items-center gap-3 border-t border-neutral-100 pt-3 lg:flex">
          <label className="flex items-center gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={conversation.follow_up_enabled}
              onChange={handleToggleFollowUp}
            />
            Auto follow-up (Day 1 / 3 / 7)
          </label>
          <input
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            placeholder="Custom follow-up message…"
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
          />
          <button
            onClick={handleSendFollowUp}
            className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Send now
          </button>
        </div>
      </div>
    </div>

      <aside className="hidden w-72 shrink-0 flex-col border-l border-neutral-200 bg-white p-4 lg:flex">
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-200 text-lg font-semibold text-neutral-600">
            {(conversation.customer_name || conversation.customer_phone).charAt(0).toUpperCase()}
          </div>
          <p className="text-sm font-semibold text-neutral-900">
            {conversation.customer_name || 'Unknown'}
          </p>
        </div>

        <div className="mb-4 flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2 text-xs">
          <span className="text-neutral-600">{conversation.customer_phone}</span>
          <button
            onClick={handleCopyPhone}
            className="shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-1 text-neutral-600 hover:bg-neutral-100"
          >
            {phoneCopied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="mb-4 rounded-md border border-neutral-200 p-3">
          <p className="mb-2 text-xs text-neutral-600">{STATUS_LABELS[conversation.status]}</p>
          {conversation.status === 'ai_active' ? (
            <button
              onClick={handleTakeOver}
              className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Take over
            </button>
          ) : (
            <button
              onClick={handleHandback}
              className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Pass Back to AI
            </button>
          )}
        </div>

        <div className="mb-4 rounded-md border border-neutral-200 p-3">
          <p className="mb-2 text-xs text-neutral-600">
            Sale outcome
            <span className="block text-[10px] text-neutral-400">
              This app can&apos;t see WhatsApp sales close -- mark it yourself so your Google Sheet lead can be
              segmented later.
            </span>
          </p>
          <OutcomeButtons outcome={conversation.sale_outcome} onSet={handleMarkOutcome} />
        </div>

        <button
          onClick={handleDelete}
          disabled={deleting}
          className="mt-auto text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete conversation'}
        </button>
      </aside>
    </div>
  );
}

function OutcomeButtons({
  outcome,
  onSet,
}: {
  outcome: Conversation['sale_outcome'];
  onSet: (outcome: 'purchased' | 'not_purchased' | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => onSet(outcome === 'purchased' ? null : 'purchased')}
        className={`rounded-md px-2.5 py-1 text-xs font-medium ${
          outcome === 'purchased'
            ? 'bg-green-600 text-white'
            : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-100'
        }`}
      >
        ✓ Purchased
      </button>
      <button
        onClick={() => onSet(outcome === 'not_purchased' ? null : 'not_purchased')}
        className={`rounded-md px-2.5 py-1 text-xs font-medium ${
          outcome === 'not_purchased'
            ? 'bg-neutral-700 text-white'
            : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-100'
        }`}
      >
        ✕ Did not buy
      </button>
    </div>
  );
}
