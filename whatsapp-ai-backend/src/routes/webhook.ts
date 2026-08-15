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
import {
  designCatalogHasEntriesForTopic,
  getNextDesignBatch,
  resolveQuotedDesignCode,
  DesignGroup,
} from '../lib/designCatalog';
import { getSizeChartImages } from '../lib/sizeChart';
import { getActivePaymentMethods, findPaymentMethod } from '../lib/paymentMethods';
import { sendLeadToGoogleSheets } from '../lib/googleSheets';
import { notifyStaff, notifyStaffFreeText } from '../lib/staffNotify';
import { generateAiReply } from '../lib/ai';
import { AdReferral, Conversation, KnowledgeBaseEntry, Message } from '../types';

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

    // Meta attaches this to whichever message resulted from a customer
    // clicking a Click-to-WhatsApp ad -- which ad, its headline/body text.
    // Stored on the conversation and handed to the AI below so the very
    // first reply can pick up where the ad left off instead of a generic
    // greeting (see formatAdReferral in lib/ai.ts). Present on any message
    // that originated from an ad click, not only ever the very first one.
    const adReferral: AdReferral | null = waMessage.referral ?? null;

    const conversation = await upsertConversation(customerPhone, customerName, text);

    if (adReferral) {
      await supabase.from('conversations').update({ ad_referral: adReferral }).eq('id', conversation.id);
      conversation.ad_referral = adReferral;
    }

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

    // Kain Pasang: QR was already sent and we're specifically waiting on the
    // customer's payment receipt -- watched for here, before any of the
    // usual reply/handoff logic below runs, so a real receipt photo is
    // never mistaken for a fresh design/payment pick.
    if (conversation.awaiting_payment_receipt) {
      const receiptLanguage = conversation.detected_language ?? detectLanguage(text);

      if (mediaUrl) {
        // Receipt's in -- this is the actual "customer paid" signal, so
        // staff only get pinged now, not back when the QR was sent.
        await supabase
          .from('conversations')
          .update({ awaiting_payment_receipt: false })
          .eq('id', conversation.id);

        const details = [
          `kod design: ${conversation.chosen_design_code}`,
          `payment: ${conversation.payment_method_chosen}`,
          'resit: dihantar',
        ];
        await handoffToStaff(
          conversation,
          'Kain Pasang',
          details,
          text || (receiptLanguage === 'ms' ? '[resit pembayaran]' : '[payment receipt]')
        );
        await sendLeadToGoogleSheets({
          customerName: conversation.customer_name,
          customerPhone: conversation.customer_phone,
          product: 'Kain Pasang',
          details: details.join(', '),
          lastMessage: text,
          status: 'Qualified — receipt received, awaiting confirmation',
        });
        if (!conversation.lead_logged_to_sheets) {
          await supabase.from('conversations').update({ lead_logged_to_sheets: true }).eq('id', conversation.id);
        }
        return;
      }

      // Not a photo -- let the AI actually answer whatever they said (they
      // might have a real question, not just silence) instead of repeating
      // a fixed reminder no matter what -- but explicitly told not to
      // reopen design/material picking, since that's already decided.
      const receiptNote =
        receiptLanguage === 'ms'
          ? `Pelanggan ini sudah pilih design ${conversation.chosen_design_code} dan kaedah pembayaran ${conversation.payment_method_chosen}, dan sedang menunggu untuk hantar resit pembayaran. Mesej terbaru mereka BUKAN gambar resit. Jika ia soalan sebenar, jawab dengan ringkas menggunakan knowledge base. Kemudian (atau jika bukan soalan) ingatkan mereka untuk hantar gambar resit supaya staff boleh sahkan tempahan. JANGAN mula semula proses pilih design/material -- itu sudah selesai.`
          : `This customer already picked design ${conversation.chosen_design_code} and payment method ${conversation.payment_method_chosen}, and is currently expected to send a payment receipt photo. Their latest message is NOT a photo. If it's a genuine question, answer it briefly using the knowledge base. Then (or if it isn't a question) remind them to send the receipt photo so staff can confirm the booking. Do NOT restart the design/material picking flow -- that's already decided.`;
      const receiptAi = await generateAiReply(conversation.id, history ?? [], null, receiptNote);

      if (receiptAi.reply) {
        const reminderSentId = await sendWhatsAppMessage(customerPhone, receiptAi.reply);
        await supabase.from('messages').insert({
          conversation_id: conversation.id,
          sender: 'ai',
          content: receiptAi.reply,
          wa_message_id: reminderSentId,
          tokens_used: receiptAi.totalTokens,
        });
      }
      return;
    }

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
    // Only passed when THIS message carries fresh referral data -- not
    // re-injected on every later turn, since the AI's first ad-aware reply
    // already carries that context forward naturally in the conversation
    // history from here on.
    const ai = await generateAiReply(conversation.id, history ?? [], adReferral);
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
        // Same lesson as design-code picking: don't rely on the model's own
        // extraction alone (it can miss a plain one-word answer like
        // "maybank" even though it names a real, offered option) -- also
        // try matching the raw reply directly, which findPaymentMethod
        // already handles tolerantly (typos, spacing, partial names).
        const paymentAnswer = ai.extractedAttributes?.paymentMethod ?? null;
        const method = (paymentAnswer && (await findPaymentMethod(paymentAnswer))) || (await findPaymentMethod(text));

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

          // Handoff is deferred to when the receipt photo actually arrives
          // (see the awaiting_payment_receipt check near the top of this
          // function) -- staff shouldn't get pinged before the customer has
          // actually paid anything, just because they picked a bank.
          const confirmMessage =
            language === 'ms'
              ? `Terima kasih! Sila buat pembayaran menggunakan QR code di atas, dan hantar resit selepas bayar ya -- saya akan maklumkan staff sebaik sahaja resit diterima 😊`
              : `Thank you! Please pay using the QR code above and send the receipt once done -- I'll let our team know the moment the receipt comes in 😊`;
          const confirmSentId = await sendWhatsAppMessage(customerPhone, confirmMessage);
          await supabase.from('messages').insert({
            conversation_id: conversation.id,
            sender: 'ai',
            content: confirmMessage,
            wa_message_id: confirmSentId,
          });

          await supabase
            .from('conversations')
            .update({
              payment_method_chosen: method.method_name,
              awaiting_payment_receipt: true,
              last_ai_or_staff_message_at: new Date().toISOString(),
            })
            .eq('id', conversation.id);

          const details = [`kod design: ${conversation.chosen_design_code}`, `payment: ${method.method_name}`];
          await sendLeadToGoogleSheets({
            customerName: conversation.customer_name,
            customerPhone: conversation.customer_phone,
            product: productGuess ?? 'Kain Pasang',
            details: details.join(', '),
            lastMessage: text,
            status: 'Qualified — payment link sent, awaiting receipt',
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
        const normalizeCode = (s: string) => s.toLowerCase().replace(/\s+/g, '');
        const normalizedText = normalizeCode(text);

        // A guess from last message is still waiting on a yes/no -- check
        // that before resolving this message as a fresh pick. Plain keyword
        // check is enough for a yes/no gate, no need to call the LLM for it.
        if (conversation.pending_design_code) {
          // Words or a plain thumbs-up/checkmark/OK-hand emoji -- customers
          // very often confirm with just an emoji on WhatsApp, no text at all.
          const isAffirmative =
            /^(ye+s?|ya|yep|yup|ok(ay|lah)?|betul|yela)\b/i.test(text.trim().toLowerCase()) ||
            /[\u{1F44D}\u{2705}\u{1F44C}]/u.test(text);
          if (isAffirmative) {
            const confirmedCode = conversation.pending_design_code;
            await proceedWithChosenDesign(conversation, customerPhone, confirmedCode, productGuess, text, language);
            return;
          }
          // Not a clear yes -- drop the guess and resolve this message
          // fresh below (they may have named a different code, or
          // swipe-replied to a different photo instead of answering).
          await supabase.from('conversations').update({ pending_design_code: null }).eq('id', conversation.id);
        }

        // Two tiers, split by how much they can be trusted:
        // - safeCode: swipe/quote-reply on a specific photo (a hard signal
        //   from Meta, context.id, not a guess) or exact/messy code typing
        //   (unambiguous once whitespace-normalized) -- trusted immediately.
        // - riskyCode: the model's own resolution of a vague reference
        //   ("yg ini", a bare number) using the codes shown earlier in the
        //   conversation -- a genuine guess, so it's confirmed with the
        //   customer before being acted on, not trusted immediately.
        const repliedToWaMessageId: string | null = waMessage.context?.id ?? null;
        const quotedCode = await resolveQuotedDesignCode(repliedToWaMessageId);
        const extractedCode = ai.extractedAttributes?.chosenDesignCode ?? null;

        const safeCode =
          (quotedCode &&
            conversation.sent_design_codes.find((code) => normalizeCode(code) === normalizeCode(quotedCode))) ||
          conversation.sent_design_codes.find((code) => normalizedText.includes(normalizeCode(code)));

        const riskyCode = !safeCode && extractedCode
          ? conversation.sent_design_codes.find((code) => normalizeCode(code) === normalizeCode(extractedCode))
          : undefined;

        if (safeCode) {
          await proceedWithChosenDesign(conversation, customerPhone, safeCode, productGuess, text, language);
          return;
        }

        if (riskyCode) {
          // Only the model's own inference from vague text lands here
          // (quote-reply and exact typing are resolved as safeCode above,
          // trusted immediately) -- confirm before committing, since acting
          // on a wrong guess here means reserving the wrong design.
          const confirmMessage =
            language === 'ms'
              ? `Maksud awak kod ${riskyCode} ya? Sila sahkan 😊`
              : `Just to confirm, you mean design ${riskyCode}? 😊`;
          const confirmSentId = await sendWhatsAppMessage(customerPhone, confirmMessage);
          await supabase.from('messages').insert({
            conversation_id: conversation.id,
            sender: 'ai',
            content: confirmMessage,
            wa_message_id: confirmSentId,
          });
          await supabase
            .from('conversations')
            .update({ pending_design_code: riskyCode, last_ai_or_staff_message_at: new Date().toISOString() })
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

          if (batch.specificRequestMatchedNothing) {
            // Customer named a real material/color but nothing in the
            // catalog matches it -- showing unrelated designs instead would
            // be misleading (each material is its own price tier), so
            // apologize and flag the gap to staff instead of substituting.
            const gapMessage =
              language === 'ms'
                ? `Maaf, design untuk "${material ?? color}" belum tersedia buat masa ini. Staff kami akan kemaskini tak lama lagi -- nak saya tunjukkan pilihan material lain yang ada sekarang? 😊`
                : `Sorry, designs for "${material ?? color}" aren't available yet. Our team will update the catalog soon -- want me to show you what's currently available instead? 😊`;
            const gapSentId = await sendWhatsAppMessage(customerPhone, gapMessage);
            await supabase.from('messages').insert({
              conversation_id: conversation.id,
              sender: 'ai',
              content: gapMessage,
              wa_message_id: gapSentId,
            });

            const { data: gapStaff } = await supabase.from('staff').select('whatsapp_number');
            const gapNotice =
              `Catalog gap: ${conversation.customer_name ?? conversation.customer_phone} ` +
              `(${conversation.customer_phone}) wants "${material ?? color}" for ${productGuess ?? 'Kain Pasang'} -- ` +
              `no active designs uploaded for this yet.`;
            for (const s of gapStaff ?? []) {
              if (s.whatsapp_number && !s.whatsapp_number.startsWith('TODO')) {
                await notifyStaffFreeText(s.whatsapp_number, gapNotice, 'catalog_gap', conversation.id);
              }
            }
            return;
          }

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

// Shared by both the "safe" pick (trusted immediately) and the "risky"
// pick once the customer's confirmed it (see the pending_design_code
// handling above) -- either way, this is the point a design is truly
// locked in, so both paths converge here to ask the same payment question.
async function proceedWithChosenDesign(
  conversation: Conversation,
  customerPhone: string,
  chosenCode: string,
  productGuess: string | null,
  text: string,
  language: string
): Promise<void> {
  const methods = await getActivePaymentMethods();

  if (methods.length === 0) {
    // No payment methods configured yet -- fall back to the old
    // staff-sends-payment-manually flow rather than asking a question with
    // nothing to answer it.
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
    .update({
      chosen_design_code: chosenCode,
      pending_design_code: null,
      last_ai_or_staff_message_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);
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
