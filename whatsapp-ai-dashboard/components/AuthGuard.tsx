'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabaseClient';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const supabase = getSupabaseClient();

    supabase.auth.getSession().then((result: { data: { session: Session | null } }) => {
      setSession(result.data.session);
      if (!result.data.session) router.replace('/login');
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, newSession: Session | null) => {
        // A staff invite (or a password-reset link) lands here with a
        // temporary session but no password ever set -- without this check,
        // that session would just drop the user straight into the
        // dashboard, and there'd be no way to actually set a password for
        // next time. Supabase fires this same event for both invite
        // acceptance and password recovery.
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        if (event === 'PASSWORD_RECOVERY' || hash.includes('type=invite') || hash.includes('type=recovery')) {
          router.replace('/set-password');
          return;
        }
        setSession(newSession);
        if (!newSession) router.replace('/login');
      }
    );

    return () => subscription.subscription.unsubscribe();
  }, [router]);

  if (session === undefined) {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  }
  if (session === null) {
    return null; // redirecting to /login
  }

  return <>{children}</>;
}
