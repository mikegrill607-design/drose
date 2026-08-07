'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/AuthGuard';
import { getSupabaseClient } from '@/lib/supabaseClient';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Conversations' },
  { href: '/dashboard/playground', label: 'Test Agent' },
  { href: '/dashboard/knowledge-base', label: 'Knowledge Base' },
  { href: '/dashboard/system-prompt', label: 'System Prompt' },
  { href: '/dashboard/usage', label: 'Usage' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await getSupabaseClient().auth.signOut();
    router.push('/login');
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-neutral-50">
        <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white p-4">
          <h2 className="mb-6 text-sm font-semibold text-neutral-900">Drose Batik</h2>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active =
                item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    active
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={handleSignOut}
            className="mt-8 w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-100"
          >
            Sign out
          </button>
        </aside>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </AuthGuard>
  );
}
