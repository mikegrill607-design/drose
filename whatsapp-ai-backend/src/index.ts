import 'dotenv/config';
import express from 'express';
import { webhookRouter } from './routes/webhook';
import { staffRouter } from './routes/staff';
import { kbRouter } from './routes/kb';
import { systemPromptRouter } from './routes/systemPrompt';
import { settingsRouter } from './routes/settings';
import { startFollowUpCron } from './cron/followUp';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/webhook', webhookRouter);
app.use('/staff', staffRouter);
app.use('/kb', kbRouter);
app.use('/system-prompt', systemPromptRouter);
app.use('/settings', settingsRouter);

startFollowUpCron();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`whatsapp-ai-backend listening on port ${port}`);
});
