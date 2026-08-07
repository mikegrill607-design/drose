import { Router } from 'express';
import { supabase } from '../lib/supabase';

export const kbRouter = Router();

kbRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('*')
    .order('topic', { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

kbRouter.post('/', async (req, res) => {
  const { topic, question, answer_ms, answer_en, is_active } = req.body ?? {};
  if (!topic || !question) {
    res.status(400).json({ error: 'topic and question are required' });
    return;
  }

  const { data, error } = await supabase
    .from('knowledge_base')
    .insert({ topic, question, answer_ms, answer_en, is_active: is_active ?? true })
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

kbRouter.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { topic, question, answer_ms, answer_en, is_active } = req.body ?? {};

  const { data, error } = await supabase
    .from('knowledge_base')
    .update({ topic, question, answer_ms, answer_en, is_active, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

kbRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('knowledge_base').delete().eq('id', id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});
