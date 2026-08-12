'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';

// Reached after accepting a staff invite (or a password reset link) --
// Supabase establishes a temporary session from the email link's token, but
// never prompts for an actual password on its own. Without this page, that
// temporary session just lands the user straight in the dashboard with no
// password ever set, so any later login attempt fails as "invalid" -- there
// was nothing to check against.
export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then((result: { data: { session: unknown } }) => {
      if (!result.data.session) {
        // No valid invite/recovery session behind this page -- nothing to do here.
        router.replace('/login');
        return;
      }
      setReady(true);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const supabase = getSupabaseClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.push('/dashboard');
  }

  if (!ready) {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Set Your Password</h1>
          <p className="text-sm text-neutral-500">Choose a password to finish setting up your staff account.</p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-neutral-700" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-neutral-700" htmlFor="confirmPassword">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Set password & continue'}
        </button>
      </form>
    </div>
  );
}
