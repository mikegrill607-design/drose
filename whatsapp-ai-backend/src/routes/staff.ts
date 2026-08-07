import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { sendWhatsAppMessage } from '../lib/whatsapp';

export const staffRouter = Router();

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
