import { Router } from 'express';
import multer from 'multer';
import { supabase } from '../lib/supabase';
import { sendWhatsAppMessage, sendWhatsAppImage } from '../lib/whatsapp';
import { uploadChatMedia, sanitizeFilename } from '../lib/chatMedia';
import { generateAiReply } from '../lib/ai';
import { detectLanguage } from '../lib/language';
import { expensiveLimiter } from '../lib/rateLimiters';
import { sendLeadToGoogleSheets } from '../lib/googleSheets';
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
staffRouter.post('/test-ai', expensiveLimiter, async (req, res) => {
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
    .update({
      status: 'staff_handling',
      last_ai_or_staff_message_at: new Date().toISOString(),
      staff_reminder_sent: false,
    })
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
    const path = `${conversationId}/${Date.now()}-${sanitizeFilename(req.file.originalname)}`;
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
      .update({
        status: 'staff_handling',
        last_ai_or_staff_message_at: new Date().toISOString(),
        staff_reminder_sent: false,
      })
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
    .update({
      status: 'staff_handling',
      last_ai_or_staff_message_at: new Date().toISOString(),
      staff_reminder_sent: false,
    })
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

  // Clears the kain-pasang browsing/payment state too -- otherwise the AI
  // would resume thinking a design/payment method was already chosen from
  // whatever happened before staff took over, even if that flow finished,
  // stalled, or the customer's now asking about something else entirely.
  // Also clears awaiting_payment_receipt and pending_design_code -- without
  // these, a customer handed back mid-payment-flow would have every future
  // message treated as "still waiting for that same receipt/confirmation",
  // regardless of what staff and the customer actually discussed.
  const { error } = await supabase
    .from('conversations')
    .update({
      status: 'ai_active',
      staff_reminder_sent: false,
      sent_design_codes: [],
      chosen_design_code: null,
      payment_method_chosen: null,
      awaiting_payment_receipt: false,
      pending_design_code: null,
    })
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

// This system has no checkout -- sales close manually over WhatsApp, so only
// a human knows whether one actually happened. Re-sends the lead's Google
// Sheets row (upserted by phone number) with just the Status column changed,
// so the owner can filter/segment "bought" vs "did not buy" leads later.
staffRouter.post('/mark-outcome', async (req, res) => {
  const { conversationId, outcome } = req.body ?? {};
  if (!conversationId || !['purchased', 'not_purchased', null].includes(outcome ?? null)) {
    res.status(400).json({ error: 'conversationId and outcome ("purchased" | "not_purchased" | null) are required' });
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

  const { error } = await supabase
    .from('conversations')
    .update({ sale_outcome: outcome ?? null })
    .eq('id', conversationId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  if (outcome) {
    await sendLeadToGoogleSheets({
      customerName: null,
      customerPhone: conversation.customer_phone,
      product: '',
      details: '',
      lastMessage: '',
      status: outcome === 'purchased' ? 'Purchased' : 'Not purchased',
      deliveryPhone: conversation.delivery_phone ?? '',
    });
  }

  res.json({ ok: true });
});

// Permanently removes a conversation and its history -- schema has no cascade
// delete on messages/follow_up_log/token_usage, so those are cleared first to
// avoid a foreign-key violation on the conversations row itself.
staffRouter.delete('/conversations/:id', async (req, res) => {
  const { id } = req.params;

  const { error: msgErr } = await supabase.from('messages').delete().eq('conversation_id', id);
  if (msgErr) {
    res.status(500).json({ error: msgErr.message });
    return;
  }

  const { error: followUpErr } = await supabase.from('follow_up_log').delete().eq('conversation_id', id);
  if (followUpErr) {
    res.status(500).json({ error: followUpErr.message });
    return;
  }

  const { error: tokenErr } = await supabase.from('token_usage').delete().eq('conversation_id', id);
  if (tokenErr) {
    res.status(500).json({ error: tokenErr.message });
    return;
  }

  const { error: alertLogErr } = await supabase.from('staff_alert_log').delete().eq('conversation_id', id);
  if (alertLogErr) {
    res.status(500).json({ error: alertLogErr.message });
    return;
  }

  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
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
