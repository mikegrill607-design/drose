import { createBrowserClient } from '@supabase/ssr';

// Browser client for reads + Realtime only, using the anon key. All writes
// that touch WhatsApp/LLM secrets go through the Railway backend instead
// (see lib/api.ts) -- this client never talks to `app_settings` directly.
let client: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}
