import express from 'express';
import * as line from '@line/bot-sdk';
import lineApiRouter from '../core/services/messaging/lineApi.js';
import { handleEvent } from '../core/services/messaging/lineHandler.js';
import { getLineChannelSecret } from '../core/services/messaging/lineConfig.js';
import { startDoneTaskPoller, stopDoneTaskPoller } from '../core/services/notion/doneTaskPoller.js';

const app = express();
const port = Number(process.env['PORT'] ?? 3000);
const lineChannelSecret = getLineChannelSecret();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Webhook — LINE middleware ตรวจ signature และ parse body ก่อน express.json()
app.post(
  '/webhook',
  line.middleware({ channelSecret: lineChannelSecret }),
  async (req, res) => {
    try {
      const events = (req.body as { events: line.WebhookEvent[] }).events ?? [];
      await Promise.all(events.map(handleEvent));
      res.json({ ok: true });
    } catch (err) {
      console.error('Webhook error:', (err as Error).message);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

// REST API routes — ต้องอยู่หลัง /webhook เพราะต้องการ express.json()
app.use('/api', express.json(), lineApiRouter);

const server = app.listen(port, () => {
  console.log(`[LINE Bot] Server running on http://localhost:${port}`);
  console.log(`[LINE Bot] Webhook URL : POST http://localhost:${port}/webhook`);
  console.log(`[LINE Bot] API base URL: http://localhost:${port}/api`);
  void startDoneTaskPoller();
});

const shutdown = (): void => {
  stopDoneTaskPoller();
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
