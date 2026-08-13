import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase';
import { uploadChatMedia, sanitizeFilename } from '../lib/chatMedia';

export const designCatalogRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB, matches WhatsApp's own image limit
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are accepted'));
      return;
    }
    cb(null, true);
  },
});

designCatalogRouter.get('/', async (req, res) => {
  const { product_topic } = req.query;
  let query = supabase.from('design_catalog').select('*').order('design_code');
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

// One photo per call -- a design code usually has 2-3 photos (full shot +
// close-ups), uploaded as separate calls sharing the same design_code so
// they group together when sent to a customer (see src/lib/designCatalog.ts).
designCatalogRouter.post('/upload', upload.single('file'), async (req, res) => {
  const { design_code, product_topic, material, color } = req.body ?? {};
  if (!design_code || !product_topic || !req.file) {
    res.status(400).json({ error: 'design_code, product_topic, and file (multipart field "file") are required' });
    return;
  }

  try {
    const path = `design-catalog/${sanitizeFilename(product_topic)}/${sanitizeFilename(design_code)}-${Date.now()}-${sanitizeFilename(req.file.originalname)}`;
    const imageUrl = await uploadChatMedia(path, req.file.buffer, req.file.mimetype);

    const { data, error } = await supabase
      .from('design_catalog')
      .insert({
        design_code,
        product_topic,
        material: material || null,
        color: color || null,
        image_url: imageUrl,
      })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to upload design photo' });
  }
});

designCatalogRouter.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { design_code, material, color, is_active } = req.body ?? {};

  const updates: Record<string, unknown> = {};
  if (design_code !== undefined) updates.design_code = design_code;
  if (material !== undefined) updates.material = material || null;
  if (color !== undefined) updates.color = color || null;
  if (is_active !== undefined) updates.is_active = is_active;

  const { data, error } = await supabase.from('design_catalog').update(updates).eq('id', id).select('*').single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

designCatalogRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('design_catalog').delete().eq('id', id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});
