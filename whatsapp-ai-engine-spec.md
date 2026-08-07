# WhatsApp AI Engine — Build Spec (v3)

**Client:** Malaysian boutique batik ecommerce brand (Drose Batik / DanielRose), 2 focus products, ads-driven traffic
**Language:** Bahasa Melayu (primary) + English (secondary) — AI detects and matches customer's language
**Stack:** Next.js dashboard (Vercel, free tier) + Node/Express backend (Railway) + Supabase (Postgres + Realtime, Pro) + WhatsApp Cloud API (Meta)
**No n8n / no Discord / no orchestration tool — straight code.**

> **Architecture split (finalized):** the WhatsApp webhook, AI logic, and follow-up cron worker run on **Railway** (always-on, no cold starts, no execution timeout, built-in cron without needing a paid Vercel tier). The **dashboard only** runs on Vercel, on the free/Hobby tier — it's low-traffic internal tooling for staff, so Pro isn't needed there.

---

## 1. Core Flow

1. Customer messages the brand's WhatsApp number (often from an ad click).
2. Meta sends the message to our **Railway-hosted webhook**.
3. AI detects language (BM or English) and replies automatically for general product/brand questions — using the descriptive knowledge base + a system prompt the owner controls. AI can answer price, material, features, etc. freely at this stage; no handoff yet.
4. **Handoff trigger:** once the customer states the specific qualifying combo needed to search real stock (e.g. "short sleeve, size L" for Kemeja Daniel Rose; material + color for Kain Pasang) → AI stops, tells the customer someone will follow up, flips conversation status to `awaiting_staff`, and sends a **WhatsApp notification to the staff number**. (See Section 6 for the precise logic — this is not a simple "any mention of price/size" keyword trigger.)
5. Staff opens the **dashboard**, sees the flagged conversation, and sends the catalog images **manually from their own phone** (outside this system).
6. After that, **staff decides** — not automatic — whether to:
   - Hand the conversation back to AI (button), or
   - Keep handling it manually themselves
7. Staff can also jump into **any** conversation at any time (not just flagged ones) and message the customer directly from the dashboard.
8. Staff can enable/compose **follow-ups** for quiet conversations — either the automatic Day 1 / Day 3 / Day 7 sequence, or a custom one-off message written on the spot.

---

## 2. Tech Stack

| Piece | Tool | Hosting |
|---|---|---|
| Dashboard (frontend + staff API routes) | Next.js (App Router) | **Vercel — Free/Hobby tier** |
| WhatsApp webhook + AI logic + cron worker | Node/Express | **Railway** — always-on, no cold starts, no timeout ceiling |
| Database + Auth + Realtime | Supabase | **Supabase Pro** (avoids free-tier auto-pause + gets daily backups — important for a live production client) |
| Messaging | WhatsApp Cloud API (Meta, official) | — |
| Scheduler | Railway cron/worker process | Runs hourly, no extra paid tier needed (unlike Vercel Cron, which needs Pro for hourly runs) |
| LLM | **Groq (Llama 3.3 70B)** — cheapest + fastest fit for the "reply quickly" requirement at your volume; you provide the API key | — |
| Dashboard auth | Supabase Auth (email/password, staff only) | — |
| WhatsApp Business credentials & staff numbers | Managed via a **Settings page in the dashboard**, stored in Supabase `app_settings`/`staff` tables — not hardcoded env vars. You already have an existing WhatsApp Business account; enter its App ID, Phone Number ID, and Access Token into Settings rather than creating a new one. | — |

> Confirm with the owner: this spec assumes the **official WhatsApp Cloud API**. If they're on an unofficial client, the integration approach changes.

**Why the Railway/Vercel split:** Vercel's serverless functions have execution time limits and cold starts, and Vercel Cron only runs hourly on the paid Pro tier — none of that fits a webhook that needs to reply fast and run a reliable hourly follow-up check. Railway runs a persistent process, so no cold starts and cron is included. The dashboard itself is low-traffic internal tooling, so it stays on Vercel's free tier without issue.

---

## 3. Supabase Schema

```sql
-- Conversations: one per customer phone number
create table conversations (
  id uuid primary key default gen_random_uuid(),
  customer_phone text unique not null,
  customer_name text,
  detected_language text, -- 'ms' | 'en'
  status text not null default 'ai_active', -- ai_active | awaiting_staff | staff_handling
  follow_up_enabled boolean not null default false,
  follow_up_stage int not null default 0, -- 0=none,1=day1,2=day3,3=day7
  last_customer_message_at timestamptz,
  last_ai_or_staff_message_at timestamptz,
  created_at timestamptz not null default now()
);

-- Messages: full chat log
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) not null,
  sender text not null, -- customer | ai | staff
  content text not null,
  wa_message_id text,
  tokens_used int, -- populated for AI-generated messages
  created_at timestamptz not null default now()
);

-- Staff (create before follow_up_log, which references it)
create table staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  whatsapp_number text not null, -- receives handoff notifications, managed from dashboard Settings page
  auth_user_id uuid references auth.users(id)
);

-- WhatsApp Business + integration settings (managed from dashboard Settings page, not hardcoded env vars)
create table app_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, -- 'whatsapp_app_id' | 'whatsapp_phone_number_id' | 'whatsapp_access_token' | 'whatsapp_verify_token'
  value text not null,
  updated_by uuid references staff(id),
  updated_at timestamptz not null default now()
);
-- Note: whatsapp_access_token is sensitive. Restrict table access to service_role only via RLS
-- (no anon/authenticated read policy on this table) — the dashboard should write to it through
-- a Railway backend API route (which uses the service role key), never directly from the browser.

-- Follow-up log (both automatic and custom)
create table follow_up_log (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) not null,
  stage int, -- 1, 2, 3, or null if custom
  message_type text not null default 'auto', -- 'auto' | 'custom'
  content text,
  sent_at timestamptz not null default now(),
  sent_by uuid references staff(id) -- null if sent by system
);

-- Knowledge base
create table knowledge_base (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  question text not null, -- example phrasing (BM or EN)
  answer_ms text, -- Bahasa Melayu answer
  answer_en text, -- English answer
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- System prompt (owner-editable, versioned)
create table system_prompt (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  is_active boolean not null default true,
  updated_by uuid references staff(id),
  created_at timestamptz not null default now()
);

-- Token usage log (for cost monitoring)
create table token_usage (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  prompt_tokens int not null,
  completion_tokens int not null,
  total_tokens int not null,
  model text not null,
  created_at timestamptz not null default now()
);
```

Enable **Realtime** on `conversations` and `messages` for the live dashboard.

---

## 4. Knowledge Base

The AI's primary source of truth for product and general questions, before falling back to generic LLM knowledge. Store both BM and English answers per entry — AI picks the right one based on `detected_language`. Product entries should be **full, descriptive text** (not just short facts) so the AI can answer confidently and hold a natural conversation without needing photos — photos only come from auntie, at handoff.

### 4.1 Product Knowledge — DanielRose & D'Rose (real content from auntie)

**Product: Kemeja Batik Cotton DanielRose**
```
Nama Produk: Kemeja Batik Cotton DanielRose
Brand: DanielRose
Kategori: Kemeja Batik Lelaki
Material: Cotton Lining
Potongan: Regular Cut
Jenis: Short Sleeve & Long Sleeve
Harga Short Sleeve: RM159
Harga Long Sleeve: RM199

Ciri-ciri:
- Batik lukisan tangan.
- Setiap corak adalah eksklusif.
- Konsep One Design, One Owner — kebanyakan design hanya tersedia satu helai.
- Material cotton lining yang selesa dipakai dan tidak panas.
- Sesuai untuk kerja, majlis, hadiah atau pakaian harian.
- Boleh dicuci menggunakan mesin atau tangan.
- Setiap pembelian disertakan kotak dan riben.
```

**Example AI conversation pattern (few-shot, store alongside the KB entry or in the system prompt):**
```
Customer: "Kemeja lelaki ada?"
AI: "Ada 😊 DanielRose mempunyai koleksi Kemeja Batik Cotton untuk lelaki. Ada pilihan short sleeve RM159 dan long sleeve RM199. Boleh saya tahu saiz dan pilihan warna yang dicari?"

Customer: "Ada design lain?"
AI: "Ada. Kebanyakan design DanielRose hanya satu helai untuk satu corak. Boleh beritahu saiz dan warna pilihan seperti pastel, terang atau gelap? Saya boleh bantu pilihkan koleksi yang sesuai."
```

**Product: Kain Pasang Batik 4 Meter D'ROSE**
```
Nama Produk: Kain Pasang Batik 4 Meter
Brand: D'ROSE Batik
Panjang: 4 meter
Kategori: Kain Batik Wanita
Material: Bergantung kepada koleksi seperti Crepe Silk dan Cotton Viscose.
Rekaan: Batik lukisan tangan.

Ciri-ciri:
- Panjang kain 4 meter.
- Sesuai dibuat baju kurung, kebaya, dress atau rekaan mengikut citarasa pelanggan.
- Terdapat pelbagai pilihan warna dan corak.
- Kebanyakan design hanya satu helai.
- Rekaan eksklusif D'ROSE dengan hasil lukisan tangan.
- Harga bergantung kepada material dan koleksi.
```

> **Note:** Focus product #2 for the initial build is **Kaftan Cotton Lovelies**, not Kain Pasang — but auntie's format above is the template to follow for every product entry going forward (Kaftan Lovelies write-up still needed from her in this same style: full descriptive product info + example AI conversation pattern).

### 4.2 The handoff trigger, restated precisely

This confirms and sharpens the funnel logic from Section 1:

- AI can answer **any general product question** fully (material, price, features, care instructions, what "One Design One Owner" means, etc.) using the descriptive KB text — no handoff needed for this.
- AI **actively asks** for the two qualifying details needed to find matching pieces: e.g. for Kemeja Daniel Rose → **sleeve type + size**; for other products → whatever auntie's equivalent qualifying questions are (e.g. color preference for Kaftan/Kain Pasang).
- **Handoff trigger = customer has given both qualifying details** (e.g. "short sleeve, size L") — that's the exact moment `awaiting_staff` fires and auntie is notified, because only she knows what's actually still in stock for that specific combination.
- Before that point (just browsing, asking general questions, hasn't specified size/sleeve/color yet), **AI keeps chatting** — it does not hand off prematurely just because "price" or "size" was mentioned in passing (e.g. "how much is short sleeve?" is answerable from KB; "I want short sleeve size L" is the handoff trigger).

This is a refinement of the original price/size/color keyword trigger — it's now **"specific enough detail given to search real stock"**, not just "any mention of price/size/color." The intent-check logic (`lib/intent.ts`) needs to detect *combinations* (e.g. size/sleeve + a clear buying signal), not just individual keywords, to avoid handing off too early.

### 4.3 Other starter topics (non-product-specific)

| Topic | Example question (BM) | Example question (EN) | Needs owner input |
|---|---|---|---|
| `shipping` | "Boleh hantar ke seluruh Malaysia?" | "Do you ship nationwide?" | Delivery areas, cost, timeframe |
| `payment_methods` | "Macam mana nak bayar?" | "How do I pay?" | Bank transfer, card, e-wallet, COD? |
| `returns` | "Boleh tukar kalau tak muat?" | "Can I exchange if it doesn't fit?" | Return/exchange policy, window |
| `how_to_order` | "Macam mana nak order?" | "How do I order?" | Order process |
| `brand_story` | "Ni brand apa?" | "Tell me about your brand" | Since 2001, exclusive hand-drawn batik |
| `delivery_time` | "Berapa lama sampai?" | "How long is delivery?" | Estimated days |
| `custom_orders` | "Boleh order custom?" | "Can I customize?" | Yes/no — if yes, route to staff |

**Dashboard KB admin page:** simple CRUD table — topic, question, BM answer, EN answer, active toggle. Owner manages this without touching code, following the same full-descriptive-text format as Section 4.1 for any new product.

---

## 5. AI Behavior & System Prompt

The system prompt is **owner-editable** via the dashboard (stored in `system_prompt` table, versioned so you can roll back). This gives the owner full control over tone, personality, and phrasing — but a few rules should be enforced by code (not just prompt instructions), since prompt-only rules can be broken by clever customer phrasing:

**Enforced in code (not just prompt):**
- Keyword/intent pre-check for pricing/size/color triggers `awaiting_staff` regardless of what the LLM would have said — cheaper and more reliable than relying on the LLM alone to self-censor
- AI never generates a reply if conversation status ≠ `ai_active`
- Language detection happens before the LLM call, so the right KB answers (BM/EN) are injected into context

**Owner-editable via system prompt (dashboard textarea):**
```
[Editable by owner in dashboard]

You are the WhatsApp assistant for [Brand Name].
Speak in [tone description — e.g. friendly, casual, uses emoji sparingly].
Primary language: Bahasa Melayu. If the customer writes in English, reply in English.
Use the knowledge base below to answer questions accurately.
Keep replies short — WhatsApp style, not paragraphs.
```

The webhook builds the final prompt sent to the LLM as:
`[owner's system prompt] + [active knowledge_base entries in customer's language] + [last N messages of conversation history]`

---

## 6. Handoff & Manual Control Logic

- **Trigger (precise):** not a simple "mentions price/size" keyword match. AI actively asks the qualifying question(s) per product (e.g. sleeve type + size for Kemeja Daniel Rose; material + color for Kain Pasang). The handoff fires only once the customer has given **the full qualifying combo** needed to search real stock (e.g. "short sleeve, size L") — general questions about price/material/features before that point are answered normally from the KB, no handoff. See Section 4.2 for the full explanation.
- **On trigger:** status = `awaiting_staff` → WhatsApp notification sent to staff number(s) with customer name/number + the qualifying details given + last message
- **Staff sends catalog:** manually, from their own phone — the system does not send catalog images
- **After handoff, staff explicitly chooses (dashboard buttons):**
  - **"Hand back to AI"** → status = `ai_active`, AI resumes automatically
  - **"Keep handling"** → status stays `staff_handling`, AI stays silent, staff replies via dashboard
- **Override anytime:** staff can click into *any* conversation (even ones AI is actively handling) and take over manually — flips status to `staff_handling` immediately, regardless of trigger

---

## 7. Dashboard — Full Feature List

**A. Live Chat Monitor**
- List of all conversations, real-time (Supabase Realtime), status badges (AI handling / awaiting staff / staff handling)
- Click into any conversation → full chat history, message input to reply directly
- Manual override button available on every conversation, not just flagged ones

**B. Token / Cost Monitoring**
- Dashboard widget: total tokens consumed (today / this week / this month), rough cost estimate based on model pricing
- Per-conversation token breakdown (from `messages.tokens_used` and `token_usage` table)

**C. Follow-Up Management**
- Per-conversation toggle: enable automatic Day 1 / Day 3 / Day 7 sequence
- **Custom follow-up composer:** staff writes a one-off message and sends it immediately to a specific customer, logged in `follow_up_log` as `message_type = 'custom'`
- Sequence auto-cancels the moment the customer replies (handled in webhook)

**D. Knowledge Base Admin**
- CRUD table: topic, BM answer, EN answer, active toggle
- Changes take effect on the next AI reply (KB fetched live or cached briefly)

**E. System Prompt Editor**
- Textarea showing current active system prompt
- Save creates a new versioned row in `system_prompt`, sets `is_active = true`, deactivates the previous version
- (Optional but recommended) simple version history list so the owner can revert if a prompt edit goes badly

**F. Settings Page (WhatsApp connection + staff numbers)**
- Form to enter/update **existing** WhatsApp Business credentials: App ID, Phone Number ID, Access Token, Webhook Verify Token — stored in `app_settings` table
- Displays the **webhook callback URL** to paste into Meta's app config (this is the Railway backend's `/webhook` endpoint — static, shown for copy-paste, not editable)
- Staff management: add/remove staff, each with a name + WhatsApp number that receives handoff notifications
- **Security note:** this page writes through a Railway backend API route (using the Supabase service role key), never directly from the browser to Supabase — the access token must never be exposed to the frontend/anon key

---

## 8. Project Structure (two repos/services)

### 8a. Backend — Railway (webhook + AI + cron)

```
whatsapp-ai-backend/
├── src/
│   ├── index.ts                 # Express app entry
│   ├── routes/
│   │   ├── webhook.ts            # Meta webhook (GET verify, POST receive)
│   │   ├── staff.ts              # send-message, send-follow-up, toggle-follow-up, take-over, handback
│   │   ├── kb.ts                 # CRUD for knowledge_base
│   │   ├── systemPrompt.ts       # get/update active prompt
│   │   └── settings.ts           # get/update app_settings (WA credentials) + staff CRUD — service-role only
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── whatsapp.ts           # send message helper; reads credentials from app_settings, not env
│   │   ├── ai.ts                 # LLM call (Groq), prompt builder, token logging
│   │   ├── intent.ts             # qualifying-combo detection (see Section 6)
│   │   └── language.ts           # detect BM vs EN
│   └── cron/
│       └── followUp.ts           # runs hourly inside the same Railway service (e.g. node-cron)
├── .env
├── package.json
└── railway.json (optional, for build/start config)
```

### 8b. Dashboard — Vercel (frontend only, free tier)

```
whatsapp-ai-dashboard/
├── app/
│   ├── dashboard/
│   │   ├── page.tsx                   # conversation list + status badges (realtime)
│   │   ├── [conversationId]/page.tsx  # chat view + controls
│   │   ├── knowledge-base/page.tsx    # KB admin table
│   │   ├── system-prompt/page.tsx     # prompt editor
│   │   ├── usage/page.tsx             # token/cost monitor
│   │   └── settings/page.tsx          # WhatsApp credentials + staff numbers
│   └── login/page.tsx
├── lib/
│   └── supabase.ts                    # calls Supabase directly for reads/realtime; writes go through Railway API
├── .env.local
└── package.json
```

The dashboard talks to Supabase directly for reads (via Realtime) and calls the Railway backend's API routes for actions that need to send WhatsApp messages (manual reply, follow-up, handoff toggles) — keeping the WhatsApp token and LLM key only on Railway, never exposed to the frontend.

---

## 9. Environment Variables

**Railway backend (`.env`) — only bootstrap secrets, not WhatsApp credentials (those live in `app_settings`, set via dashboard Settings page after first deploy):**
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GROQ_API_KEY=
WEBHOOK_BASE_URL=   # this service's own public URL, so Settings page can display the callback URL to paste into Meta
```

**Vercel dashboard (`.env.local`):**
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_BACKEND_API_URL=   # Railway service URL, for staff action calls
```

> WhatsApp App ID, Phone Number ID, Access Token, and Webhook Verify Token are entered once through the dashboard's **Settings** page after the backend is deployed (Section 7F) — not hardcoded. The backend reads them from `app_settings` on each request (or caches briefly). This lets staff reconnect/update the WhatsApp Business account without a code deploy.

---

## 10. Follow-Up Cron (runs on Railway, not Vercel)

Implemented as an in-process scheduled job (e.g. `node-cron`) inside the Railway backend service — runs hourly, no separate paid tier needed. Logic:
1. Query conversations where `follow_up_enabled = true` and `follow_up_stage < 3`
2. Compute days since `last_customer_message_at`
3. Day ≥1 & stage=0 → send stage 1, set stage=1
4. Day ≥3 & stage=1 → send stage 2, set stage=2
5. Day ≥7 & stage=2 → send stage 3, set stage=3, auto-disable `follow_up_enabled`
6. Any inbound customer message resets `follow_up_stage = 0` and `follow_up_enabled = false` (handled in the webhook route, not the cron job)

---

## 11. Build Order (execute in this sequence in VS Code)

**Backend (Railway) first:**
1. Set up Supabase project, run schema SQL from Section 3, enable Realtime on `conversations`/`messages`
2. `mkdir whatsapp-ai-backend && cd whatsapp-ai-backend`, init Node/Express + TypeScript project
3. Build `src/lib/supabase.ts`, `src/lib/whatsapp.ts`
4. Build `src/lib/language.ts` (BM/EN detection) and `src/lib/intent.ts` (qualifying-combo detection per Section 6)
5. Build `src/routes/webhook.ts` — receive message, detect language, store in `messages`, upsert `conversations`, run intent check
6. Build `src/lib/ai.ts` — fetch active system prompt + KB (in detected language) + last N messages, call LLM, log tokens
7. Wire webhook: qualifying combo detected → flip status, notify staff, skip AI. Else → call AI, send reply, log message + tokens.
8. Build `src/routes/staff.ts` (manual reply, take-over, handback, follow-up toggle/composer), `src/routes/kb.ts`, `src/routes/systemPrompt.ts`, and `src/routes/settings.ts` (WhatsApp credentials + staff CRUD, service-role only)
9. Build `src/cron/followUp.ts`, wire into `src/index.ts` with node-cron (hourly)
10. Deploy to Railway, note the service's public URL

**Dashboard (Vercel) second:**
11. `npx create-next-app@latest whatsapp-ai-dashboard` (TypeScript, App Router)
12. Build login page (Supabase Auth) and conversation list page (Realtime)
13. Build per-conversation chat view with manual reply + take-over button (calls Railway backend)
14. Build knowledge base admin page (CRUD, calls Railway backend)
15. Build system prompt editor page (with versioning, calls Railway backend)
16. Build usage/token monitoring page
17. Build follow-up UI: toggle for auto sequence + custom composer
18. Build Settings page: form for WhatsApp App ID/Phone Number ID/Access Token/Verify Token, displays webhook callback URL to paste into Meta, staff add/remove
19. Deploy dashboard to Vercel (free tier)

**Final steps:**
20. Fill in Settings with the **existing** WhatsApp Business account's credentials, paste the displayed callback URL into Meta's app config
21. Seed `knowledge_base` (Section 4) and initial `system_prompt` with owner-confirmed content
22. Test end-to-end on a WhatsApp test number before going live

---

## 12. Open Questions Before/During Build

- Official WhatsApp Cloud API confirmed?
- Exact tone/personality for the system prompt — casual boutique brand voice, how much emoji, formality level
- Which staff number(s) receive handoff notifications
- Confirm KB answers (shipping, payment, returns, material, order process) in both BM and English
- Any PDPA (Malaysia's data protection law) consent notice needed before storing chat data in Supabase?
- Token/cost monitoring — does the owner want a simple RM-converted estimate on the dashboard, or raw token counts are enough?
- Confirm the existing WhatsApp Business account's App ID, Phone Number ID, and Access Token are ready to hand over/enter into Settings

---

## 13. Production Cost Estimate (at ~1,000–2,000 conversations/month)

> Estimates only — WhatsApp Business Platform pricing and LLM pricing both change; verify current rates before finalizing client pricing. A "conversation" here follows Meta's 24-hour-window model — many messages from the same customer within 24 hours typically count as one conversation, not per-message.

| Item | Estimate (RM/month) | Notes |
|---|---|---|
| Vercel (dashboard, free tier) | RM0 | Low-traffic internal tool, free tier sufficient |
| Supabase (Pro) | ~RM118 | Avoids free-tier auto-pause + gets backups — needed for a live client |
| Railway (webhook + cron worker) | RM25–95 | Small always-on service |
| LLM (Groq, Llama 3.3 70B) | RM40–100 | Fast + cheap, good fit for the reply-speed goal |
| WhatsApp — customer-initiated conversations | Low/often free-tier | Customer messages first (your entire model — ad click → PM) |
| WhatsApp — follow-up messages (Day 1/3/7) | RM50–150 | Only conversations staff opts into; business-initiated = template rate |
| Domain (amortized) | ~RM5 | — |
| **Total, safe-side estimate** | **~RM240–470/month** | Comfortable margin against a RM800–1,200/month retainer |
