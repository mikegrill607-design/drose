'use client';

import { use, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { backendApi } from '@/lib/api';
import { Conversation, Message } from '@/lib/types';

export default function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = use(params);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [followUpText, setFollowUpText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

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

  async function handleTakeOver() {
    await backendApi.takeOver(conversationId);
  }

  async function handleHandback() {
    await backendApi.handback(conversationId);
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
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-sm font-semibold text-neutral-900">
            {conversation.customer_name || conversation.customer_phone}
          </h1>
          <p className="text-xs text-neutral-500">{conversation.customer_phone}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
            {conversation.status}
          </span>
          {conversation.status === 'ai_active' ? (
            <button
              onClick={handleTakeOver}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
            >
              Take over
            </button>
          ) : (
            <button
              onClick={handleHandback}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
            >
              Hand back to AI
            </button>
          )}
        </div>
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
              <p>{m.content}</p>
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a reply…"
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

        <div className="mt-3 flex items-center gap-3 border-t border-neutral-100 pt-3">
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
            className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-50"
          >
            Send now
          </button>
        </div>
      </div>
    </div>
  );
}
