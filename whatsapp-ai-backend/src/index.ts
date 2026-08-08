import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { webhookRouter } from './routes/webhook';
import { staffRouter } from './routes/staff';
import { kbRouter } from './routes/kb';
import { systemPromptRouter } from './routes/systemPrompt';
import { settingsRouter } from './routes/settings';
import { startFollowUpCron } from './cron/followUp';
import { requireStaffAuth } from './lib/requireStaffAuth';
import { ensureChatMediaBucket } from './lib/chatMedia';

const app = express();
app.use(cors());
// Captures the raw request bytes alongside the parsed body -- webhook.ts
// needs the exact original bytes (not a re-serialized JSON.stringify) to
// verify Meta's X-Hub-Signature-256 HMAC.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Meta calls this directly (no browser, no session) -- must stay open.
app.use('/webhook', webhookRouter);

// Everything else is dashboard-only: require a valid Supabase staff session.
app.use('/staff', requireStaffAuth, staffRouter);
app.use('/kb', requireStaffAuth, kbRouter);
app.use('/system-prompt', requireStaffAuth, systemPromptRouter);
app.use('/settings', requireStaffAuth, settingsRouter);

ensureChatMediaBucket();
startFollowUpCron();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`whatsapp-ai-backend listening on port ${port}`);
});
