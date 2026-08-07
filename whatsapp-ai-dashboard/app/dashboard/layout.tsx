'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/AuthGuard';
import { getSupabaseClient } from '@/lib/supabaseClient';

// Full nav -- desktop sidebar only.
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Conversations' },
  { href: '/dashboard/playground', label: 'Test Agent' },
  { href: '/dashboard/knowledge-base', label: 'Knowledge Base' },
  { href: '/dashboard/system-prompt', label: 'System Prompt' },
  { href: '/dashboard/usage', label: 'Usage' },
  { href: '/dashboard/settings', label: 'Settings' },
];

// Scoped down for phones: staff on the move just need conversations (reply +
// send catalog photos) and a look at the numbers -- admin pages (KB, prompt,
// settings) stay desktop-only.
const MOBILE_NAV_ITEMS = [
  { href: '/dashboard', label: 'Chats', icon: '💬' },
  { href: '/dashboard/usage', label: 'Usage', icon: '📊' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await getSupabaseClient().auth.signOut();
    router.push('/login');
  }

  function isActive(href: string) {
    return href === '/dashboard' ? pathname === href : pathname.startsWith(href);
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-neutral-50">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 border-r border-neutral-200 bg-white p-4 sm:flex sm:flex-col">
          <h2 className="mb-6 text-sm font-semibold text-neutral-900">Drose Batik</h2>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  isActive(item.href) ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <button
            onClick={handleSignOut}
            className="mt-8 w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-100"
          >
            Sign out
          </button>
        </aside>

        {/* Mobile top bar */}
        <header className="fixed inset-x-0 top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 sm:hidden">
          <h2 className="text-sm font-semibold text-neutral-900">Drose Batik</h2>
          <button onClick={handleSignOut} className="text-xs text-neutral-500">
            Sign out
          </button>
        </header>

        <main className="flex-1 overflow-auto pt-12 pb-16 sm:pt-0 sm:pb-0">{children}</main>

        {/* Mobile bottom tab bar */}
        <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-neutral-200 bg-white sm:hidden">
          {MOBILE_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                isActive(item.href) ? 'text-neutral-900' : 'text-neutral-400'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </AuthGuard>
  );
}
