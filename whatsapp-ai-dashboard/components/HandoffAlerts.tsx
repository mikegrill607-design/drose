'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { Conversation } from '@/lib/types';

interface ToastState {
  id: string;
  message: string;
}

// A short beep via the Web Audio API -- no audio file to bundle. Browsers
// that require a user gesture before audio can play will just silently no-op
// here (wrapped in try/catch); the badge + toast are the reliable signal,
// this is a nice-to-have on top.
function playChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Best-effort only.
  }
}

// Works purely off the same Supabase Realtime connection the rest of the
// dashboard already uses -- no dependency on Meta/WhatsApp delivery at all,
// so it's a reliable backup for staff who have the dashboard open (desktop
// or mobile browser) even if a WhatsApp alert doesn't arrive.
export function useHandoffAlerts() {
  const [unhandledCount, setUnhandledCount] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();

    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'awaiting_staff')
      .then(({ count }: { count: number | null }) => setUnhandledCount(count ?? 0));

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    const channel = supabase
      .channel('handoff-alerts')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations' },
        (payload: { old: Conversation; new: Conversation }) => {
          const wasAwaiting = payload.old.status === 'awaiting_staff';
          const isAwaiting = payload.new.status === 'awaiting_staff';

          if (isAwaiting && !wasAwaiting) {
            setUnhandledCount((c) => c + 1);

            const message = `New handoff: ${payload.new.customer_name || payload.new.customer_phone}`;
            setToast({ id: payload.new.id, message });
            if (toastTimer.current) clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setToast(null), 6000);

            playChime();
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification('Drose Batik', { body: message });
            }
          } else if (wasAwaiting && !isAwaiting) {
            setUnhandledCount((c) => Math.max(0, c - 1));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  return { unhandledCount, toast, dismissToast: () => setToast(null) };
}

export function NotificationBell({ count, className = '' }: { count: number; className?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push('/dashboard')}
      title={count > 0 ? `${count} conversation(s) awaiting staff` : 'No conversations awaiting staff'}
      className={`relative rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 ${className}`}
    >
      <span className="text-base">🔔</span>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

export function HandoffToast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className="fixed left-1/2 top-14 z-50 w-[90%] max-w-sm -translate-x-1/2 sm:top-4">
      <button
        onClick={onDismiss}
        className="w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 shadow-lg"
      >
        <span className="mr-1.5">🔔</span>
        {toast.message}
      </button>
    </div>
  );
}
