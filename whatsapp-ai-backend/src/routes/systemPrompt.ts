import { Router } from 'express';
import { supabase } from '../lib/supabase';

export const systemPromptRouter = Router();

systemPromptRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('system_prompt')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

// Saving creates a new versioned row and deactivates the previous one
// (spec Section 7E) so the owner can roll back via history.
systemPromptRouter.post('/', async (req, res) => {
  const { content, staffId } = req.body ?? {};
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  await supabase.from('system_prompt').update({ is_active: false }).eq('is_active', true);

  const { data, error } = await supabase
    .from('system_prompt')
    .insert({ content, is_active: true, updated_by: staffId ?? null })
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});
