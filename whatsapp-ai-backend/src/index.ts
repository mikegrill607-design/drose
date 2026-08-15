import 'dotenv/config';
import { Sentry } from './lib/sentry'; // must init before other imports that might throw during setup
import express from 'express';
import cors from 'cors';
import { webhookRouter } from './routes/webhook';
import { staffRouter } from './routes/staff';
import { kbRouter } from './routes/kb';
import { designCatalogRouter } from './routes/designCatalog';
import { sizeChartRouter } from './routes/sizeChart';
import { paymentMethodsRouter } from './routes/paymentMethods';
import { systemPromptRouter } from './routes/systemPrompt';
import { settingsRouter } from './routes/settings';
import { templatesRouter } from './routes/templates';
import { publicStatsRouter } from './routes/publicStats';
import { startFollowUpCron } from './cron/followUp';
import { startTemplateStatusCron } from './cron/templateStatus';
import { startStaffReminderCron } from './cron/staffReminder';
import { requireStaffAuth } from './lib/requireStaffAuth';
import { ensureChatMediaBucket } from './lib/chatMedia';
import { webhookLimiter, apiLimiter } from './lib/rateLimiters';

const app = express();
// Railway sits in front of this app as a reverse proxy -- without this,
// express-rate-limit (and req.ip generally) would see Railway's proxy hop
// instead of the real client IP, either lumping all traffic together or
// being trivially bypassable. Trusting exactly one hop matches Railway's
// setup (single edge proxy in front of the app).
app.set('trust proxy', 1);
// Auth here is a Bearer token the frontend sets explicitly (not an
// auto-attached cookie), so a wide-open CORS policy isn't a classic CSRF
// risk -- but restricting it to the dashboard's own domains is still cheap
// defense-in-depth against a compromised/malicious third-party site probing
// this API from a staff member's browser.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || /\.vercel\.app$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
  })
);
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
app.use('/webhook', webhookLimiter, webhookRouter);

// Deliberately public, no auth -- backs a shareable stats link
// (app/stats/page.tsx). Rate-limited like the rest of the API, but not
// gated behind requireStaffAuth; only ever serves the one aggregate defined
// in publicStats.ts, never conversation/customer detail.
app.use('/public-stats', apiLimiter, publicStatsRouter);

// Everything else is dashboard-only: require a valid Supabase staff session.
app.use('/staff', apiLimiter, requireStaffAuth, staffRouter);
app.use('/kb', apiLimiter, requireStaffAuth, kbRouter);
app.use('/design-catalog', apiLimiter, requireStaffAuth, designCatalogRouter);
app.use('/size-chart', apiLimiter, requireStaffAuth, sizeChartRouter);
app.use('/payment-methods', apiLimiter, requireStaffAuth, paymentMethodsRouter);
app.use('/system-prompt', apiLimiter, requireStaffAuth, systemPromptRouter);
app.use('/settings', apiLimiter, requireStaffAuth, settingsRouter);
app.use('/templates', apiLimiter, requireStaffAuth, templatesRouter);

// Catches anything thrown/rejected inside a route handler that wasn't
// already caught locally -- reports it to Sentry (a no-op if SENTRY_DSN
// isn't set) before Express's own default handler sends the response.
Sentry.setupExpressErrorHandler(app);

// Crons and webhook processing run outside any request/response cycle, so
// an error in the middle of async work there wouldn't hit Express's error
// handler at all -- these two are the actual process-level safety net for
// "this crashed and nobody logged why."
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  Sentry.captureException(err);
});

ensureChatMediaBucket();
startFollowUpCron();
startTemplateStatusCron();
startStaffReminderCron();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`whatsapp-ai-backend listening on port ${port}`);
});
