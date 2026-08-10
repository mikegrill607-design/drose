import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Router } from 'express';
import { supabase } from '../lib/supabase';
import { getAppSettings } from '../lib/appSettings';
import { sendWhatsAppMessage, downloadWhatsAppMedia } from '../lib/whatsapp';
import { uploadChatMedia } from '../lib/chatMedia';
import { detectLanguage } from '../lib/language';
import { checkQualifyingCombo } from '../lib/intent';
import { selectRelevantKb } from '../lib/kbRouter';
import { sendLeadToGoogleSheets } from '../lib/googleSheets';
import { notifyStaff } from '../lib/staffNotify';
import { generateAiReply } from '../lib/ai';
import { Conversation, KnowledgeBaseEntry, Message } from '../types';

export const webhookRouter = Router();

// Confirms a POST really came from Meta (not someone who found the webhook
// URL) by checking the X-Hub-Signature-256 HMAC against WA_APP_SECRET (Meta
// Developer Portal -> App Settings -> Basic -> App Secret). Deliberately
// fails OPEN (skips the check, just warns) when the secret isn't configured
// yet, rather than fail closed and silently break live message delivery the
// moment this code deploys, before the env var has been added.
function verifyMetaSignature(req: Request): boolean {
  const appSecret = process.env.WA_APP_SECRET;
  if (!appSecret) {
    console.warn('WA_APP_SECRET not set -- webhook signature verification is currently skipped');
    return true;
  }

  const signatureHeader = req.headers['x-hub-signature-256'];
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (typeof signatureHeader !== 'string' || !rawBody) return false;

  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const signatureBuf = Buffer.from(signatureHeader);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(signatureBuf, expectedBuf);
}

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
  if (!verifyMetaSignature(req)) {
    res.sendStatus(401);
    return;
  }

  // Ack immediately -- Meta retries aggressively on slow/failed responses.
  res.sendStatus(200);

  // Meta can batch several messages into ONE webhook POST (entry[] and
  // messages[] are both arrays for exactly this reason) -- this happens in
  // practice whenever multiple messages arrive close together, which is
  // common under ad-driven traffic bursts. Only reading index [0] silently
  // dropped every other message in the batch with no error at all. Process
  // every entry/change/message found, and sequentially (not in parallel) so
  // two messages from the same brand-new customer in one batch can't race
  // upsertConversation into inserting duplicate rows.
  const entries = req.body?.entry ?? [];
  for (const entry of entries) {
    const changes = entry?.changes ?? [];
    for (const change of changes) {
      const value = change?.value;
      const messages = value?.messages ?? [];
      for (let i = 0; i < messages.length; i++) {
        try {
          await processInboundMessage(messages[i], value?.contacts?.[i]?.profile?.name);
        } catch (err) {
          console.error('webhook message processing failed', err);
        }
      }
    }
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Meta's webhook payload shape, not modeled elsewhere in this codebase
async function processInboundMessage(waMessage: any, customerName: string | undefined): Promise<void> {
  const customerPhone: string = waMessage.from;
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

    // intent.ts is generic across every product (not hardcoded per name), so
    // it can't say WHICH product this is about -- reuse the same KB keyword
    // router that picks AI reply context to guess it. A KB match at all
    // (even without the full qualifying combo) is a lighter signal of real
    // product interest, used below to log a "quality lead" the first time it
    // shows up in this conversation -- not just when they've given enough
    // detail for a full staff handoff.
    const { data: kbEntries } = await supabase
      .from('knowledge_base')
      .select('topic, content, keywords')
      .eq('is_active', true);
    // Search the WHOLE conversation, not just the last few messages -- unlike
    // the AI reply's context window, guessing which product a handoff/lead is
    // about should never forget an early "kemeja ada?" just because the
    // qualifying details arrived several messages later.
    const [topMatch] = selectRelevantKb(
      (kbEntries ?? []) as KnowledgeBaseEntry[],
      customerMessages,
      customerMessages.length
    );
    const productGuess = topMatch ? topMatch.topic.replace(/^product_/, '').replace(/_/g, ' ') : null;

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

      await handoffToStaff(conversation, productGuess ?? 'Unknown -- see message below', intent.matchedDetails, text);
      await sendLeadToGoogleSheets({
        customerName: conversation.customer_name,
        customerPhone: conversation.customer_phone,
        product: productGuess ?? 'Unknown',
        details: intent.matchedDetails.join(', '),
        lastMessage: text,
        status: 'Qualified — handed to staff',
      });
      if (!conversation.lead_logged_to_sheets) {
        await supabase.from('conversations').update({ lead_logged_to_sheets: true }).eq('id', conversation.id);
      }
      return;
    }

    if (!conversation.lead_logged_to_sheets) {
      // Every lead gets a row, not just ones that show product interest --
      // the "Status" column is what tells qualified apart from not, so
      // non-qualified/browsing customers can still be remarketed to
      // differently instead of being invisible in the spreadsheet.
      await sendLeadToGoogleSheets({
        customerName: conversation.customer_name,
        customerPhone: conversation.customer_phone,
        product: productGuess ?? '',
        details: '',
        lastMessage: text,
        status: 'Not qualified — chatting',
      });
      await supabase.from('conversations').update({ lead_logged_to_sheets: true }).eq('id', conversation.id);
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
}

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
        // A new customer message changes the situation staff need to
        // react to -- re-arm the reminder rather than let a stale "already
        // reminded" flag suppress a fresh nudge for this new message.
        staff_reminder_sent: false,
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
    .update({
      status: 'awaiting_staff',
      // Marks the moment this started needing staff attention --
      // cron/staffReminder.ts measures "untouched" from here. Previously
      // never set on handoff, so the reminder cron had no reliable signal.
      last_ai_or_staff_message_at: new Date().toISOString(),
      staff_reminder_sent: false,
    })
    .eq('id', conversation.id);

  const { data: staff } = await supabase.from('staff').select('whatsapp_number');
  const notice =
    `New handoff: ${conversation.customer_name ?? conversation.customer_phone} ` +
    `(${conversation.customer_phone})\nProduct: ${product}\nDetails: ${details.join(', ')}\n` +
    `Last message: "${lastMessage}"`;

  for (const s of staff ?? []) {
    if (s.whatsapp_number && !s.whatsapp_number.startsWith('TODO')) {
      await notifyStaff(s.whatsapp_number, {
        freeText: notice,
        templateSettingKey: 'staff_handoff_template',
        templateParams: [
          conversation.customer_name ?? conversation.customer_phone,
          conversation.customer_phone,
          product,
          details.join(', '),
        ],
      });
    }
  }
}
