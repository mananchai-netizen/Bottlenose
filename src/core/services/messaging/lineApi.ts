import express, { type Request, type Response } from 'express';
import * as line from '@line/bot-sdk';
import { getLineChannelAccessToken } from './lineConfig.js';

const router = express.Router();

function createLineClient(): line.messagingApi.MessagingApiClient {
  return new line.messagingApi.MessagingApiClient({
    channelAccessToken: getLineChannelAccessToken(),
  });
}

// POST /send — ส่งข้อความหา user คนเดียว
// Body: { userId, message }
router.post('/send', async (req: Request, res: Response) => {
  console.log('ส่งข้อความหา user คนเดียว');
  const { userId, message } = req.body as { userId?: string; message?: string };
  if (!userId || !message) {
    res.status(400).json({ error: 'userId and message are required' });
    return;
  }
  try {
    const client = createLineClient();
    await client.pushMessage({ to: userId, messages: [{ type: 'text', text: message }] });
    res.json({ success: true, to: userId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /multicast — ส่งข้อความหาหลาย user พร้อมกัน (สูงสุด 500 คน)
// Body: { userIds: [...], message }
router.post('/multicast', async (req: Request, res: Response) => {
  console.log('ส่งข้อความหาหลาย user พร้อมกัน (สูงสุด 500 คน)');
  const { userIds, message } = req.body as { userIds?: string[]; message?: string };
  if (!Array.isArray(userIds) || userIds.length === 0 || !message) {
    res.status(400).json({ error: 'userIds (array) and message are required' });
    return;
  }
  try {
    const client = createLineClient();
    await client.multicast({ to: userIds, messages: [{ type: 'text', text: message }] });
    res.json({ success: true, count: userIds.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /broadcast — broadcast ไปยังทุก follower
// Body: { message }
router.post('/broadcast', async (req: Request, res: Response) => {
  console.log('broadcast ไปยังทุก follower');
  const { message } = req.body as { message?: string };
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  try {
    const client = createLineClient();
    await client.broadcast({ messages: [{ type: 'text', text: message }] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /profile/:userId — ดึงข้อมูล profile ของ user
router.get('/profile/:userId', async (req: Request, res: Response) => {
  const userId = req.params['userId'];
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }
  try {
    const client = createLineClient();
    const profile = await client.getProfile(userId);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /send-image — ส่งรูปภาพหา user
// Body: { userId, imageUrl, previewUrl }
router.post('/send-image', async (req: Request, res: Response) => {
  const { userId, imageUrl, previewUrl } = req.body as {
    userId?: string;
    imageUrl?: string;
    previewUrl?: string;
  };
  if (!userId || !imageUrl) {
    res.status(400).json({ error: 'userId and imageUrl are required' });
    return;
  }
  try {
    const client = createLineClient();
    await client.pushMessage({
      to: userId,
      messages: [
        {
          type: 'image',
          originalContentUrl: imageUrl,
          previewImageUrl: previewUrl ?? imageUrl,
        },
      ],
    });
    res.json({ success: true, to: userId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /send-flex — ส่ง Flex Message หา user
// Body: { userId, altText, contents }
router.post('/send-flex', async (req: Request, res: Response) => {
  const { userId, altText, contents } = req.body as {
    userId?: string;
    altText?: string;
    contents?: line.messagingApi.FlexContainer;
  };
  if (!userId || !contents) {
    res.status(400).json({ error: 'userId and contents are required' });
    return;
  }
  try {
    const client = createLineClient();
    await client.pushMessage({
      to: userId,
      messages: [
        {
          type: 'flex',
          altText: altText ?? 'Flex Message',
          contents,
        },
      ],
    });
    res.json({ success: true, to: userId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
