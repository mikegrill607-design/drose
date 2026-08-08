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

// One document per category (topic) -- parses the PDF and saves it in a
// single step (no separate "extract, then paste into a form" flow). Uploading
// the same topic again replaces its content (upsert on the topic unique
// constraint), so re-uploading an updated product sheet just works.
kbRouter.post('/upload', upload.single('file'), async (req, res) => {
  const { topic, keywords } = req.body ?? {};
  if (!topic) {
    res.status(400).json({ error: 'topic is required' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'file is required (multipart field "file")' });
    return;
  }

  try {
    const parser = new PDFParse({ data: req.file.buffer });
    const result = await parser.getText();
    await parser.destroy();

    if (!result.text.trim()) {
      res.status(422).json({ error: 'no extractable text found in this PDF' });
      return;
    }

    const { data, error } = await supabase
      .from('knowledge_base')
      .upsert(
        {
          topic,
          keywords: keywords || null,
          content: result.text,
          source_filename: req.file.originalname,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'topic' }
      )
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : 'failed to process PDF' });
  }
});

// Metadata-only edits (rename category, tweak keywords, toggle active) --
// content itself only changes by re-uploading a PDF via POST /kb/upload.
kbRouter.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { topic, keywords, is_active } = req.body ?? {};

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (topic !== undefined) updates.topic = topic;
  if (keywords !== undefined) updates.keywords = keywords || null;
  if (is_active !== undefined) updates.is_active = is_active;

  const { data, error } = await supabase
    .from('knowledge_base')
    .update(updates)
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
