import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { getAppSettings } from '../lib/appSettings';
import { sendWhatsAppMessage, downloadWhatsAppMedia } from '../lib/whatsapp';
import { uploadChatMedia } from '../lib/chatMedia';
import { detectLanguage } from '../lib/language';
import { checkQualifyingCombo } from '../lib/intent';
import { generateAiReply } from '../lib/ai';
import { Conversation, Message } from '../types';

export const webhookRouter = Router();

// --- GET: Meta webhook verification ---
webhookRouter.get('/', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const settings = await getAppSettings();

  if (mode === 'subscribe' && token && token === settings.whatsapp_verify_token) {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

// --- POST: inbound WhatsApp messages ---
webhookRouter.post('/', async (req, res) => {
  // Ack immediately -- Meta retries aggressively on slow/failed responses.
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const waMessage = value?.messages?.[0];
    if (!waMessage) return; // status update / non-message webhook, ignore

    const customerPhone: string = waMessage.from;
    const customerName: string | undefined = value?.contacts?.[0]?.profile?.name;
    const waMessageId: string = waMessage.id;

    let text = '';
    let mediaUrl: string | null = null;

    if (waMessage.type === 'image' && waMessage.image?.id) {
      text = waMessage.image.caption ?? '';
      const media = await downloadWhatsAppMedia(waMessage.image.id);
      if (media) {
        const ext = media.mimeType.split('/')[1] ?? 'jpg';
        mediaUrl = await uploadChatMedia(`${customerPhone}/${Date.now()}.${ext}`, media.buffer, media.mimeType);
      }
    } else {
      text = waMessage.text?.body ?? '';
    }

    const conversation = await upsertConversation(customerPhone, customerName, text);

    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      sender: 'customer',
      content: text,
      media_url: mediaUrl,
      wa_message_id: waMessageId,
    });

    // Any inbound message cancels a pending follow-up sequence (spec Section 10.6).
    if (conversation.follow_up_enabled || conversation.follow_up_stage !== 0) {
      await supabase
        .from('conversations')
        .update({ follow_up_enabled: false, follow_up_stage: 0 })
        .eq('id', conversation.id);
    }

    if (conversation.status !== 'ai_active') {
      // Staff is already handling (or it's awaiting staff) -- AI stays silent.
      return;
    }

    const { data: history } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });

    const customerMessages = (history ?? []).filter((m: Message) => m.sender === 'customer');
    const intent = checkQualifyingCombo(customerMessages);

    if (intent.qualifyingComboMet) {
      const language = conversation.detected_language ?? detectLanguage(text);
      const handoffMessage =
        language === 'ms'
          ? 'Terima kasih! Staff kami akan follow up dengan koleksi yang sesuai sekejap lagi ya 😊'
          : "Thank you! Our team will follow up shortly with matching pieces 😊";

      const sentId = await sendWhatsAppMessage(customerPhone, handoffMessage);
      await supabase.from('messages').insert({
        conversation_id: conversation.id,
        sender: 'ai',
        content: handoffMessage,
        wa_message_id: sentId,
      });

      await handoffToStaff(conversation, intent.matchedProduct!, intent.matchedDetails, text);
      return;
    }

    const language = conversation.detected_language ?? detectLanguage(text);
    if (!conversation.detected_language) {
      await supabase.from('conversations').update({ detected_language: language }).eq('id', conversation.id);
    }

    const ai = await generateAiReply(conversation.id, history ?? []);
    if (!ai.reply) return;

    const sentId = await sendWhatsAppMessage(customerPhone, ai.reply);

    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      sender: 'ai',
      content: ai.reply,
      wa_message_id: sentId,
      tokens_used: ai.totalTokens,
    });

    await supabase
      .from('conversations')
      .update({ last_ai_or_staff_message_at: new Date().toISOString() })
      .eq('id', conversation.id);
  } catch (err) {
    console.error('webhook processing failed', err);
  }
});

async function upsertConversation(
  customerPhone: string,
  customerName: string | undefined,
  latestMessage: string
): Promise<Conversation> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('customer_phone', customerPhone)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  if (existing) {
    const { data: updated, error } = await supabase
      .from('conversations')
      .update({
        customer_name: customerName ?? existing.customer_name,
        last_customer_message_at: nowIso,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return updated as Conversation;
  }

  const language = detectLanguage(latestMessage);
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      customer_phone: customerPhone,
      customer_name: customerName ?? null,
      detected_language: language,
      status: 'ai_active',
      last_customer_message_at: nowIso,
    })
    .select('*')
    .single();
  if (error) throw error;
  return created as Conversation;
}

async function handoffToStaff(
  conversation: Conversation,
  product: string,
  details: string[],
  lastMessage: string
): Promise<void> {
  await supabase
    .from('conversations')
    .update({ status: 'awaiting_staff' })
    .eq('id', conversation.id);

  const { data: staff } = await supabase.from('staff').select('whatsapp_number');
  const notice =
    `New handoff: ${conversation.customer_name ?? conversation.customer_phone} ` +
    `(${conversation.customer_phone})\nProduct: ${product}\nDetails: ${details.join(', ')}\n` +
    `Last message: "${lastMessage}"`;

  for (const s of staff ?? []) {
    if (s.whatsapp_number && !s.whatsapp_number.startsWith('TODO')) {
      await sendWhatsAppMessage(s.whatsapp_number, notice);
    }
  }
}
