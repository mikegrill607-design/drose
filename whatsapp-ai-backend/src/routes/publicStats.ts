import { Router } from 'express';
import { supabase } from '../lib/supabase';

export const publicStatsRouter = Router();

interface PublicAiPerformanceRow {
  total_purchased: number;
  purchased_by_ai_only: number;
}

// No auth on this route by design (mounted without requireStaffAuth in
// index.ts) -- it's meant to be shared as a plain link. Only ever returns
// this one aggregate; never customer names, phone numbers, or messages.
publicStatsRouter.get('/ai-performance', async (_req, res) => {
  const { data, error } = await supabase.rpc('get_public_ai_performance_stats').single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const row = data as PublicAiPerformanceRow;
  res.json({
    totalPurchased: row.total_purchased,
    purchasedByAiOnly: row.purchased_by_ai_only,
    aiCloseRate: row.total_purchased === 0 ? null : row.purchased_by_ai_only / row.total_purchased,
  });
});
