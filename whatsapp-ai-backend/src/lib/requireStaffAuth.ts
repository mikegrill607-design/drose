import { Request, Response, NextFunction } from 'express';
import { supabase } from './supabase';

// Everything except /webhook (which Meta calls directly, no user session)
// goes through this. The dashboard is Supabase Auth, so it just forwards its
// session's access token; the service-role client can validate any user's
// token via getUser(). Without this, opening CORS for the dashboard would
// leave WhatsApp credentials and the LLM API key readable/writable by anyone
// who finds the Railway URL.
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

  next();
}
