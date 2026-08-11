import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase';
import { uploadChatMedia } from '../lib/chatMedia';

export const sizeChartRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are accepted'));
      return;
    }
    cb(null, true);
  },
});

sizeChartRouter.get('/', async (req, res) => {
  const { product_topic } = req.query;
  let query = supabase.from('size_chart_images').select('*').order('created_at');
  if (typeof product_topic === 'string' && product_topic) {
    query = query.eq('product_topic', product_topic);
  }
  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

sizeChartRouter.post('/upload', upload.single('file'), async (req, res) => {
  const { product_topic, label } = req.body ?? {};
  if (!product_topic || !req.file) {
    res.status(400).json({ error: 'product_topic and file (multipart field "file") are required' });
    return;
  }

  try {
    const path = `size-chart/${product_topic}/${Date.now()}-${req.file.originalname}`;
    const imageUrl = await uploadChatMedia(path, req.file.buffer, req.file.mimetype);

    const { data, error } = await supabase
      .from('size_chart_images')
      .insert({ product_topic, label: label || null, image_url: imageUrl })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to upload size chart image' });
  }
});

sizeChartRouter.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { label, is_active } = req.body ?? {};

  const updates: Record<string, unknown> = {};
  if (label !== undefined) updates.label = label || null;
  if (is_active !== undefined) updates.is_active = is_active;

  const { data, error } = await supabase.from('size_chart_images').update(updates).eq('id', id).select('*').single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

sizeChartRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('size_chart_images').delete().eq('id', id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});
