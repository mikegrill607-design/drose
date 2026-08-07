import { Router } from 'express';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { supabase } from '../lib/supabase';

export const kbRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are accepted'));
      return;
    }
    cb(null, true);
  },
});

// Extracts raw text from an uploaded PDF so staff can paste/trim it into a KB
// entry instead of retyping it -- doesn't create anything on its own, just
// returns text for the dashboard form to pre-fill (spec extension: see
// whatsapp-ai-dashboard/app/dashboard/knowledge-base/page.tsx).
kbRouter.post('/extract-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'file is required (multipart field "file")' });
    return;
  }

  try {
    const parser = new PDFParse({ data: req.file.buffer });
    const result = await parser.getText();
    await parser.destroy();
    res.json({ text: result.text });
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : 'failed to parse PDF' });
  }
});

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
