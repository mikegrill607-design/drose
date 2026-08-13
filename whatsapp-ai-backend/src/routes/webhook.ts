import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Router } from 'express';
import { Sentry } from '../lib/sentry';
import { supabase } from '../lib/supabase';
import { getAppSettings } from '../lib/appSettings';
import { sendWhatsAppMessage, sendWhatsAppImage, downloadWhatsAppMedia } from '../lib/whatsapp';
import { uploadChatMedia } from '../lib/chatMedia';
import { detectLanguage } from '../lib/language';
import { resolveQualifyingCombo } from '../lib/intent';
import { selectRelevantKb } from '../lib/kbRouter';
import { designCatalogHasEntriesForTopic, getNextDesignBatch, DesignGroup } from '../lib/designCatalog';
import { getSizeChartImages } from '../lib/sizeChart';
import { getActivePaymentMethods, findPaymentMethod } from '../lib/paymentMethods';
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
          Sentry.captureException(err);
        }
      }

      // Meta also reports delivery outcomes for messages THIS app sent
      // (sent/delivered/read/failed) in the same webhook shape -- previously
      // ignored entirely, which is why "the API said 200" and "did it
      // actually arrive" were two different, unanswerable questions. Now
      // recorded on the original message row so delivery can be confirmed
      // (or a real failure reason seen) straight from the database.
      const statuses = value?.statuses ?? [];
      for (const status of statuses) {
        try {
          await processStatusUpdate(status);
        } catch (err) {
          console.error('webhook status processing failed', err);
          Sentry.captureException(err);
        }
      }
    }
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Meta's webhook payload shape, not modeled elsewhere in this codebase
async function processStatusUpdate(status: any): Promise<void> {
  const waMessageId: string | undefined = status?.id;
  const newStatus: string | undefined = status?.status; // 'sent' | 'delivered' | 'read' | 'failed'
  if (!waMessageId || !newStatus) return;

  const errorDetail = Array.isArray(status?.errors)
    ? status.errors.map((e: { code?: number; title?: string; message?: string }) => `[${e.code}] ${e.title ?? e.message ?? ''}`).join('; ')
    : null;

  // The message could be a customer-conversation message OR a staff alert
  // (handoff/reminder/test) -- those live in two different tables, and a
  // given wa_message_id only ever belongs to one of them. Try both rather
  // than assuming; an update matching 0 rows is a silent no-op either way.
  const { error: messagesError, count: messagesCount } = await supabase
    .from('messages')
    .update({ delivery_status: newStatus, delivery_error: errorDetail }, { count: 'exact' })
    .eq('wa_message_id', waMessageId);
  if (messagesError) console.error('Failed to record delivery status on messages for', waMessageId, messagesError);

  if (!messagesCount) {
    const { error: alertError } = await supabase
      .from('staff_alert_log')
      .update({ delivery_status: newStatus, delivery_error: errorDetail })
      .eq('wa_message_id', waMessageId);
    if (alertError) console.error('Failed to record delivery status on staff_alert_log for', waMessageId, alertError);
  }
}

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

    // Any inbound message cancels a pending follow-up sequence -- but does
    // NOT disable follow-up entirely, since it's automatic-by-default now
    // (spec Section 10.6). If they go quiet again later, the sequence
    // should restart from stage 1, not stay off just because staff never
    // manually re-enabled it.
    if (conversation.follow_up_stage !== 0 || conversation.follow_up_last_sent_at) {
      await supabase
        .from('conversations')
        .update({ follow_up_stage: 0, follow_up_last_sent_at: null })
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

    const language = conversation.detected_language ?? detectLanguage(text);
    if (!conversation.detected_language) {
      await supabase.from('conversations').update({ detected_language: language }).eq('id', conversation.id);
    }

    // Always generate the reply first -- besides being the normal AI reply,
    // this is now also where qualifying-detail extraction comes from (see
    // ATTRIBUTE_EXTRACTION_INSTRUCTION in src/lib/ai.ts), since the model
    // already understands typos/phrasing ("pemdek" for "pendek", etc.) that
    // the regex-only detector kept missing. On the one message that turns
    // out to qualify, this generated reply is discarded in favor of the
    // fixed handoff message below -- a small one-time cost per conversation
    // in exchange for not silently dropping real qualifying messages.
    const ai = await generateAiReply(conversation.id, history ?? []);
    const intent = resolveQualifyingCombo(customerMessages, ai.extractedAttributes);

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

    // Size chart images -- a simpler, separate exception to "AI never sends
    // photos" than the design catalog below: no "pick one" step, just a
    // fixed reference image (or set of them, e.g. short/long sleeve charts)
    // sent once so the customer can check exact measurements while telling
    // the AI their size. Only products with rows in size_chart_images get
    // this; everything else is unaffected. Fires as soon as the topic is
    // recognized, before the qualifying-combo/design-catalog branches below
    // (which can return early), so it isn't skipped on a message that
    // happens to also qualify immediately.
    if (topMatch && !conversation.sent_size_chart) {
      const chartImages = await getSizeChartImages(topMatch.topic);
      if (chartImages.length > 0) {
        for (const chart of chartImages) {
          const sentId = await sendWhatsAppImage(customerPhone, chart.image_url, chart.label ?? undefined);
          await supabase.from('messages').insert({
            conversation_id: conversation.id,
            sender: 'ai',
            content: chart.label ?? '',
            media_url: chart.image_url,
            wa_message_id: sentId,
          });
        }
        await supabase.from('conversations').update({ sent_size_chart: true }).eq('id', conversation.id);
      }
    }

    // Design-catalog products (kain-pasang style) are a deliberate exception
    // to "AI never sends photos" -- the AI sends the actual design-code
    // photos itself once material is known, then walks the customer through
    // picking a payment method and sends the matching QR code too. Staff
    // only step in at the end, to confirm the booking once payment's been
    // sent. Products with no catalog rows (e.g. Kemeja) fall through to the
    // regular generic 2-of-4 attribute handoff below unchanged.
    const hasDesignCatalog = topMatch ? await designCatalogHasEntriesForTopic(topMatch.topic) : false;

    if (hasDesignCatalog && topMatch) {
      if (conversation.chosen_design_code) {
        // Stage 3: a design's already been picked -- this reply should be their payment method choice.
        const paymentAnswer = ai.extractedAttributes?.paymentMethod ?? null;
        const method = paymentAnswer ? await findPaymentMethod(paymentAnswer) : null;

        if (method) {
          const qrCaption = [method.method_name, method.account_holder, method.account_number]
            .filter(Boolean)
            .join(' — ');
          const qrSentId = await sendWhatsAppImage(customerPhone, method.image_url, qrCaption);
          await supabase.from('messages').insert({
            conversation_id: conversation.id,
            sender: 'ai',
            content: qrCaption,
            media_url: method.image_url,
            wa_message_id: qrSentId,
          });

          const confirmMessage =
            language === 'ms'
              ? `Terima kasih! Sila buat pembayaran menggunakan QR code di atas, dan hantar resit selepas bayar ya. Staff kami akan sahkan design ${conversation.chosen_design_code} sekejap lagi 😊`
              : `Thank you! Please pay using the QR code above and send the receipt once done. Our team will confirm design ${conversation.chosen_design_code} shortly 😊`;
          const confirmSentId = await sendWhatsAppMessage(customerPhone, confirmMessage);
          await supabase.from('messages').insert({
            conversation_id: conversation.id,
            sender: 'ai',
            content: confirmMessage,
            wa_message_id: confirmSentId,
          });

          await supabase
            .from('conversations')
            .update({ payment_method_chosen: method.method_name })
            .eq('id', conversation.id);

          const details = [`kod design: ${conversation.chosen_design_code}`, `payment: ${method.method_name}`];
          await handoffToStaff(conversation, productGuess ?? 'Kain Pasang', details, text);
          await sendLeadToGoogleSheets({
            customerName: conversation.customer_name,
            customerPhone: conversation.customer_phone,
            product: productGuess ?? 'Kain Pasang',
            details: details.join(', '),
            lastMessage: text,
            status: 'Qualified — payment sent, awaiting confirmation',
          });
          if (!conversation.lead_logged_to_sheets) {
            await supabase.from('conversations').update({ lead_logged_to_sheets: true }).eq('id', conversation.id);
          }
          return;
        }
        // Haven't named a recognized payment method yet -- fall through to a
        // normal reply so the AI can re-ask, per the system prompt.
      } else if (conversation.sent_design_codes.length > 0) {
        // Stage 2: at least one batch already shown -- did they pick one, or ask for more?
        const chosenCode = conversation.sent_design_codes.find((code) =>
          text.toLowerCase().includes(code.toLowerCase())
        );

        if (chosenCode) {
          const methods = await getActivePaymentMethods();

          if (methods.length === 0) {
            // No payment methods configured yet -- fall back to the old
            // staff-sends-payment-manually flow rather than asking a
            // question with nothing to answer it.
            const handoffMessage =
              language === 'ms'
                ? `Terima kasih! Staff kami akan sahkan design ${chosenCode} dan hantar butiran pembayaran sekejap lagi ya 😊`
                : `Thank you! Our team will confirm design ${chosenCode} and send payment details shortly 😊`;
            const sentId = await sendWhatsAppMessage(customerPhone, handoffMessage);
            await supabase.from('messages').insert({
              conversation_id: conversation.id,
              sender: 'ai',
              content: handoffMessage,
              wa_message_id: sentId,
            });

            const details = [`kod design: ${chosenCode}`];
            await handoffToStaff(conversation, productGuess ?? 'Kain Pasang', details, text);
            await sendLeadToGoogleSheets({
              customerName: conversation.customer_name,
              customerPhone: conversation.customer_phone,
              product: productGuess ?? 'Kain Pasang',
              details: details.join(', '),
              lastMessage: text,
              status: 'Qualified — handed to staff',
            });
            if (!conversation.lead_logged_to_sheets) {
              await supabase.from('conversations').update({ lead_logged_to_sheets: true }).eq('id', conversation.id);
            }
            return;
          }

          const methodNames = methods.map((m) => m.method_name).join(' / ');
          const askPaymentMessage =
            language === 'ms'
              ? `Bagus, pilihan yang cantik! Untuk design ${chosenCode}, anda nak bayar guna payment method yang mana -- ${methodNames}?`
              : `Great choice! For design ${chosenCode}, which payment method would you like to use -- ${methodNames}?`;
          const askSentId = await sendWhatsAppMessage(customerPhone, askPaymentMessage);
          await supabase.from('messages').insert({
            conversation_id: conversation.id,
            sender: 'ai',
            content: askPaymentMessage,
            wa_message_id: askSentId,
          });

          await supabase
            .from('conversations')
            .update({ chosen_design_code: chosenCode, last_ai_or_staff_message_at: new Date().toISOString() })
            .eq('id', conversation.id);
          return;
        }

        if (ai.extractedAttributes?.wantsMoreDesigns) {
          const material = ai.extractedAttributes?.material ?? null;
          const color = ai.extractedAttributes?.color ?? null;
          const batch = await getNextDesignBatch(topMatch.topic, material, color, conversation.sent_design_codes);

          if (batch.groups.length > 0) {
            await sendDesignBatch(conversation.id, customerPhone, batch.groups);

            const askMessage =
              language === 'ms'
                ? batch.hasMore
                  ? 'Design-design ni okay tak? Kalau tak berkenan, saya boleh tunjukkan design lain 😊'
                  : 'Ini semua design yang ada buat masa ini. Mana satu awak suka? 😊'
                : batch.hasMore
                  ? 'Are these designs okay? If not, I can show you more 😊'
                  : "That's all the designs we currently have available. Which one do you like? 😊";
            const askId = await sendWhatsAppMessage(customerPhone, askMessage);
            await supabase.from('messages').insert({
              conversation_id: conversation.id,
              sender: 'ai',
              content: askMessage,
              wa_message_id: askId,
            });

            await supabase
              .from('conversations')
              .update({
                sent_design_codes: [...conversation.sent_design_codes, ...batch.groups.map((g) => g.designCode)],
                last_ai_or_staff_message_at: new Date().toISOString(),
              })
              .eq('id', conversation.id);
          } else {
            const noMoreMessage =
              language === 'ms'
                ? 'Maaf, tiada lagi design lain buat masa ini. Boleh pilih dari design yang telah ditunjukkan tadi? 😊'
                : "Sorry, there aren't any more designs available right now. Could you pick from the ones already shown? 😊";
            const noMoreId = await sendWhatsAppMessage(customerPhone, noMoreMessage);
            await supabase.from('messages').insert({
              conversation_id: conversation.id,
              sender: 'ai',
              content: noMoreMessage,
              wa_message_id: noMoreId,
            });
          }
          return;
        }
        // Designs already sent, no code named and not asking for more -- fall through to a normal reply.
      } else {
        // Stage 1: nothing shown yet.
        const material = ai.extractedAttributes?.material ?? null;
        const color = ai.extractedAttributes?.color ?? null;

        if (material || color) {
          const batch = await getNextDesignBatch(topMatch.topic, material, color, []);
          if (batch.groups.length > 0) {
            await sendDesignBatch(conversation.id, customerPhone, batch.groups);

            const askMessage =
              language === 'ms'
                ? batch.hasMore
                  ? 'Design-design ni okay tak? Kalau tak berkenan, saya boleh tunjukkan design lain 😊'
                  : 'Kod design mana yang anda suka? 😊'
                : batch.hasMore
                  ? 'Are these designs okay? If not, I can show you more 😊'
                  : 'Which design code do you like? 😊';
            const askId = await sendWhatsAppMessage(customerPhone, askMessage);
            await supabase.from('messages').insert({
              conversation_id: conversation.id,
              sender: 'ai',
              content: askMessage,
              wa_message_id: askId,
            });

            await supabase
              .from('conversations')
              .update({
                sent_design_codes: batch.groups.map((g) => g.designCode),
                last_ai_or_staff_message_at: new Date().toISOString(),
              })
              .eq('id', conversation.id);
            return;
          }
        }
        // Not enough info yet to narrow down designs -- fall through to a normal reply.
      }
    } else if (intent.qualifyingComboMet) {
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

// Sends every photo for a batch of design groups (each code's full shot +
// close-ups), captioning only the first photo of each code so the code
// itself is easy to spot without repeating it on every single image.
async function sendDesignBatch(conversationId: string, customerPhone: string, groups: DesignGroup[]): Promise<void> {
  for (const group of groups) {
    for (let i = 0; i < group.imageUrls.length; i++) {
      const caption = i === 0 ? `Kod Design: ${group.designCode}` : undefined;
      const sentId = await sendWhatsAppImage(customerPhone, group.imageUrls[i], caption);
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender: 'ai',
        content: caption ?? '',
        media_url: group.imageUrls[i],
        wa_message_id: sentId,
      });
    }
  }
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
        kind: 'handoff',
        conversationId: conversation.id,
      });
    }
  }
}
