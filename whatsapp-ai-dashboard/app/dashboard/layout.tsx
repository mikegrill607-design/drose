'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/AuthGuard';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useHandoffAlerts, NotificationBell, HandoffToast } from '@/components/HandoffAlerts';

// Full nav -- desktop sidebar only. Grouped into labeled sections rather
// than one flat list, same pattern as the client's other dashboards.
const NAV_GROUPS: { heading: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    heading: 'Monitor',
    items: [
      { href: '/dashboard/overview', label: 'Overview', icon: '📋' },
      { href: '/dashboard', label: 'WhatsApp', icon: '💬' },
      { href: '/dashboard/usage', label: 'Usage', icon: '📊' },
    ],
  },
  {
    heading: 'Configure',
    items: [
      { href: '/dashboard/playground', label: 'Test Agent', icon: '🧪' },
      { href: '/dashboard/knowledge-base', label: 'Knowledge Base', icon: '📚' },
      { href: '/dashboard/design-catalog', label: 'Design Catalog', icon: '🖼️' },
      { href: '/dashboard/system-prompt', label: 'System Prompt', icon: '📝' },
      { href: '/dashboard/follow-up', label: 'Follow-Up Messages', icon: '🔔' },
      { href: '/dashboard/templates', label: 'Templates', icon: '💬' },
    ],
  },
  {
    heading: 'Connect',
    items: [{ href: '/dashboard/settings', label: 'Settings', icon: '⚙️' }],
  },
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
  const { unhandledCount, toast, dismissToast } = useHandoffAlerts();

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
        <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white p-4 sm:flex">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Drose Batik</h2>
            <NotificationBell count={unhandledCount} />
          </div>
          <nav className="space-y-6">
            {NAV_GROUPS.map((group) => (
              <div key={group.heading}>
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  {group.heading}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
                        isActive(item.href) ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                      }`}
                    >
                      <span className="text-sm">{item.icon}</span>
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <button
            onClick={handleSignOut}
            className="mt-auto w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-100"
          >
            Sign out
          </button>
        </aside>

        {/* Mobile top bar */}
        <header className="fixed inset-x-0 top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 sm:hidden">
          <h2 className="text-sm font-semibold text-neutral-900">Drose Batik</h2>
          <div className="flex items-center gap-1">
            <NotificationBell count={unhandledCount} />
            <button onClick={handleSignOut} className="px-1.5 text-xs text-neutral-500">
              Sign out
            </button>
          </div>
        </header>

        <HandoffToast toast={toast} onDismiss={dismissToast} />

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
