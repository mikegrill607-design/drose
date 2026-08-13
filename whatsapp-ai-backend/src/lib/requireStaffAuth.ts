import { Request, Response, NextFunction } from 'express';
import { supabase } from './supabase';

// Everything except /webhook (which Meta calls directly, no user session)
// goes through this. The dashboard is Supabase Auth, so it just forwards its
// session's access token; the service-role client can validate any user's
// token via getUser(). Without this, opening CORS for the dashboard would
// leave WhatsApp credentials and the LLM API key readable/writable by anyone
// who finds the Railway URL.
//
// A valid Supabase session alone is NOT enough -- Supabase Auth allows email
// signup independently of this app (anyone with the public anon key can call
// supabase.auth.signUp directly, bypassing the dashboard's login-only UI), so
// this also requires the session's user to actually be listed in `staff`
// (auth_user_id set when inviting them from Settings). Otherwise any
// self-registered account -- or a stale test account -- would carry the same
// access as a real staff member.
export async function requireStaffAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    res.status(401).json({ error: 'missing Authorization bearer token' });
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'invalid or expired session' });
    return;
  }

  const { data: staffRow, error: staffErr } = await supabase
    .from('staff')
    .select('id')
    .eq('auth_user_id', data.user.id)
    .maybeSingle();
  if (staffErr || !staffRow) {
    res.status(403).json({ error: 'this account is not registered as staff' });
    return;
  }

  next();
}
