import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

// Service-role client. This backend is the only thing that ever holds this
// key -- the dashboard only uses the anon key from the browser.
export const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
