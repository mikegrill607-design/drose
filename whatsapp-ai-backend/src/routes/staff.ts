import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase';
import { sendWhatsAppMessage, sendWhatsAppImage } from '../lib/whatsapp';
import { uploadChatMedia } from '../lib/chatMedia';
import { generateAiReply } from '../lib/ai';
import { detectLanguage } from '../lib/language';
import { MessageSender } from '../types';

export const staffRouter = Router();

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

// Dashboard "Test Agent" playground: runs the exact same system prompt + KB +
// LLM path as a real webhook reply, but never touches WhatsApp or the
// conversations/messages tables -- lets staff sanity-check prompt/KB changes
// before going live. Token usage is still logged (it's a real LLM call and
// costs real money) but with conversation_id = null so it doesn't pollute any
// customer's per-conversation breakdown on the Usage page.
staffRouter.post('/test-ai', async (req, res) => {
  const { messages } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages (non-empty array) is required' });
    return;
  }

  const validSenders: MessageSender[] = ['customer', 'ai', 'staff'];
  const history = messages
    .filter(
      (m): m is { sender: MessageSender; content: string } =>
        typeof m?.content === 'string' && validSenders.includes(m?.sender)
    )
    .map((m) => ({ sender: m.sender, content: m.content, media_url: null }));

  if (history.length === 0) {
    res.status(400).json({ error: 'no valid messages provided' });
    return;
  }

  const lastCustomerMessage = [...history].reverse().find((m) => m.sender === 'customer');
  const language = detectLanguage(lastCustomerMessage?.content ?? '');

  try {
    const result = await generateAiReply(null, history);
    res.json({ reply: result.reply, language, totalTokens: result.totalTokens });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI call failed' });
  }
});

// Manual reply from the dashboard -- also takes the conversation over.
staffRouter.post('/send-message', async (req, res) => {
  const { conversationId, text, staffId } = req.body ?? {};
  if (!conversationId || !text) {
    res.status(400).json({ error: 'conversationId and text are required' });
    return;
  }

  const { data: conversation, error: convErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();
  if (convErr || !conversation) {
    res.status(404).json({ error: 'conversation not found' });
    return;
  }

  const sentId = await sendWhatsAppMessage(conversation.customer_phone, text);

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender: 'staff',
    content: text,
    wa_message_id: sentId,
  });

  await supabase
    .from('conversations')
    .update({ status: 'staff_handling', last_ai_or_staff_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  res.json({ ok: true, staffId: staffId ?? null });
});

// Catalog/image send from the dashboard (or mobile web view) -- this is the
// only way images go out once the number is on the Cloud API, since staff
// can no longer dual-use a personal WhatsApp app on that same number.
staffRouter.post('/send-image', upload.single('file'), async (req, res) => {
  const { conversationId, caption, staffId } = req.body ?? {};
  if (!conversationId || !req.file) {
    res.status(400).json({ error: 'conversationId and file (multipart field "file") are required' });
    return;
  }

  const { data: conversation, error: convErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();
  if (convErr || !conversation) {
    res.status(404).json({ error: 'conversation not found' });
    return;
  }

  try {
    const path = `${conversationId}/${Date.now()}-${req.file.originalname}`;
    const publicUrl = await uploadChatMedia(path, req.file.buffer, req.file.mimetype);

    const sentId = await sendWhatsAppImage(conversation.customer_phone, publicUrl, caption || undefined);

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender: 'staff',
      content: caption || '',
      media_url: publicUrl,
      wa_message_id: sentId,
    });

    await supabase
      .from('conversations')
      .update({ status: 'staff_handling', last_ai_or_staff_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    res.json({ ok: true, mediaUrl: publicUrl, staffId: staffId ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed to send image' });
  }
});

// Staff jumps into ANY conversation, not just flagged ones (spec Section 6).
staffRouter.post('/take-over', async (req, res) => {
  const { conversationId } = req.body ?? {};
  if (!conversationId) {
    res.status(400).json({ error: 'conversationId is required' });
    return;
  }

  const { error } = await supabase
    .from('conversations')
    .update({ status: 'staff_handling' })
    .eq('id', conversationId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

// Explicit staff decision to resume AI (spec Section 6) -- never automatic.
staffRouter.post('/handback', async (req, res) => {
  const { conversationId } = req.body ?? {};
  if (!conversationId) {
    res.status(400).json({ error: 'conversationId is required' });
    return;
  }

  const { error } = await supabase
    .from('conversations')
    .update({ status: 'ai_active' })
    .eq('id', conversationId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

staffRouter.post('/follow-up/toggle', async (req, res) => {
  const { conversationId, enabled } = req.body ?? {};
  if (!conversationId || typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'conversationId and enabled(boolean) are required' });
    return;
  }

  const { error } = await supabase
    .from('conversations')
    .update({ follow_up_enabled: enabled, follow_up_stage: enabled ? 0 : 0 })
    .eq('id', conversationId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

// One-off custom follow-up, sent immediately (spec Section 7C).
staffRouter.post('/follow-up/custom', async (req, res) => {
  const { conversationId, text, staffId } = req.body ?? {};
  if (!conversationId || !text) {
    res.status(400).json({ error: 'conversationId and text are required' });
    return;
  }

  const { data: conversation, error: convErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();
  if (convErr || !conversation) {
    res.status(404).json({ error: 'conversation not found' });
    return;
  }

  await sendWhatsAppMessage(conversation.customer_phone, text);

  await supabase.from('follow_up_log').insert({
    conversation_id: conversationId,
    stage: null,
    message_type: 'custom',
    content: text,
    sent_by: staffId ?? null,
  });

  res.json({ ok: true });
});

// Staff CRUD (also available via settings.ts; kept here for convenience from
// the conversation-facing part of the dashboard).
staffRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase.from('staff').select('*').order('name');
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});
