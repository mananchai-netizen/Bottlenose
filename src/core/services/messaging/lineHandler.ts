import * as line from '@line/bot-sdk';
import { getLineChannelAccessToken } from './lineConfig.js';

function createLineClient(): line.messagingApi.MessagingApiClient {
  return new line.messagingApi.MessagingApiClient({
    channelAccessToken: getLineChannelAccessToken(),
  });
}

export async function handleEvent(event: line.WebhookEvent): Promise<void> {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }

  const lineClient = createLineClient();
  const userId = event.source.userId;
  if (!userId) return;

  const userText = event.message.text.trim();
  const replyToken = event.replyToken;

  if (userText.toLowerCase() === '/help' || userText === '/ช่วยเหลือ') {
    const helpText = [
      `🤖 ${process.env.AGENT_NAME ?? 'AI Assistant'}`,
      '',
      'คำสั่งที่ใช้ได้:',
      '/help — แสดงคำสั่งทั้งหมด',
    ].join('\n');

    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: helpText }],
    });
  }
}

export async function pushMessage(userId: string, message: string): Promise<void> {
  const lineClient = createLineClient();
  await lineClient.pushMessage({
    to: userId,
    messages: [{ type: 'text', text: message }],
  });
}

export async function broadcastMessage(message: string): Promise<void> {
  const lineClient = createLineClient();
  await lineClient.broadcast({ messages: [{ type: 'text', text: message }] });
}
