import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase';
import { uploadChatMedia, sanitizeFilename } from '../lib/chatMedia';

export const paymentMethodsRouter = Router();

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

paymentMethodsRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase.from('payment_methods').select('*').order('method_name');
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

paymentMethodsRouter.post('/upload', upload.single('file'), async (req, res) => {
  const { method_name, account_holder, account_number } = req.body ?? {};
  if (!method_name || !req.file) {
    res.status(400).json({ error: 'method_name and file (multipart field "file") are required' });
    return;
  }

  try {
    const path = `payment-methods/${Date.now()}-${sanitizeFilename(req.file.originalname)}`;
    const imageUrl = await uploadChatMedia(path, req.file.buffer, req.file.mimetype);

    const { data, error } = await supabase
      .from('payment_methods')
      .insert({
        method_name,
        account_holder: account_holder || null,
        account_number: account_number || null,
        image_url: imageUrl,
      })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to upload payment method' });
  }
});

paymentMethodsRouter.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { method_name, account_holder, account_number, is_active } = req.body ?? {};

  const updates: Record<string, unknown> = {};
  if (method_name !== undefined) updates.method_name = method_name;
  if (account_holder !== undefined) updates.account_holder = account_holder || null;
  if (account_number !== undefined) updates.account_number = account_number || null;
  if (is_active !== undefined) updates.is_active = is_active;

  const { data, error } = await supabase.from('payment_methods').update(updates).eq('id', id).select('*').single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

paymentMethodsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('payment_methods').delete().eq('id', id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});
