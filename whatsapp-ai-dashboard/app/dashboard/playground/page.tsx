'use client';

import { useRef, useState } from 'react';
import { backendApi } from '@/lib/api';

interface PlaygroundMessage {
  sender: 'customer' | 'ai';
  content: string;
}

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [lastMeta, setLastMeta] = useState<{ language: string; totalTokens: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleSend() {
    if (!draft.trim() || sending) return;
    const nextMessages: PlaygroundMessage[] = [...messages, { sender: 'customer', content: draft.trim() }];
    setMessages(nextMessages);
    setDraft('');
    setSending(true);
    setError(null);

    try {
      const result = await backendApi.testAi(nextMessages);
      setMessages((prev) => [...prev, { sender: 'ai', content: result.reply }]);
      setLastMeta({ language: result.language, totalTokens: result.totalTokens });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI call failed');
    } finally {
      setSending(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  function handleReset() {
    setMessages([]);
    setLastMeta(null);
    setError(null);
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-neutral-200 bg-white px-6 py-3">
        <h1 className="text-sm font-semibold text-neutral-900">Test Agent</h1>
        <p className="text-xs text-neutral-500">
          Chats with the live system prompt + knowledge base + configured LLM provider. Nothing here is sent
          over WhatsApp or saved to any real conversation -- safe to try before going live.
        </p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-400">Send a message below to try the agent.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.sender === 'customer' ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-md rounded-lg px-3 py-2 text-sm ${
                m.sender === 'customer'
                  ? 'border border-neutral-200 bg-white text-neutral-900'
                  : 'bg-neutral-900 text-white'
              }`}
            >
              <p>{m.content}</p>
            </div>
          </div>
        ))}
        {sending && <p className="text-xs text-neutral-400">Thinking…</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-neutral-200 bg-white p-4">
        {lastMeta && (
          <p className="mb-2 text-xs text-neutral-400">
            Detected language: {lastMeta.language} · Last reply: {lastMeta.totalTokens} tokens
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a customer message to test…"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={sending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            Send
          </button>
          <button
            onClick={handleReset}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
