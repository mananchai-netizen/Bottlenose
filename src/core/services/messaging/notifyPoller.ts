import axios from 'axios';
import { pushMessage } from './lineHandler.js';

type NotificationItem = { text?: string } | string;
type FetchFn = (sinceDate: Date) => Promise<NotificationItem[]>;

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let lastCheckedTime = new Date();

export async function sendLineNotify(message: string): Promise<void> {
  const token = process.env.LINE_NOTIFY_TOKEN;
  if (!token) {
    console.warn('LINE_NOTIFY_TOKEN not set, skipping');
    return;
  }

  await axios.post(
    'https://notify-api.line.me/api/notify',
    new URLSearchParams({ message }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );
}

export async function checkNotifyStatus(): Promise<Record<string, unknown> | null> {
  const token = process.env.LINE_NOTIFY_TOKEN;
  if (!token) return null;

  const res = await axios.get<Record<string, unknown>>(
    'https://notify-api.line.me/api/status',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.data;
}

export function startPolling(
  fetchFn: FetchFn,
  targetUserId: string | null = null,
  intervalMs = 60000,
): void {
  if (pollingInterval) {
    console.log('Polling already running');
    return;
  }

  console.log(`Starting polling every ${intervalMs / 1000}s`);

  pollingInterval = setInterval(async () => {
    try {
      const notifications = await fetchFn(lastCheckedTime);
      lastCheckedTime = new Date();

      for (const notification of notifications) {
        const raw = typeof notification === 'string' ? notification : (notification.text ?? '');
        const message = `🔔 แจ้งเตือน\n${raw}`;

        if (targetUserId) {
          await pushMessage(targetUserId, message);
        } else {
          await sendLineNotify(message);
        }
      }
    } catch (err) {
      console.error('Polling error:', (err as Error).message);
    }
  }, intervalMs);
}

export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('Polling stopped');
  }
}
