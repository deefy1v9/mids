export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(req: NextRequest) {
  const talkId = req.nextUrl.searchParams.get('talkId');
  if (!talkId) return NextResponse.json({ error: 'talkId required' }, { status: 400 });

  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const token = process.env.KOMMO_ACCESS_TOKEN;
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    // Step 1: get the talk to find the chat_id
    const { data: talkData } = await axios.get(`${base}/talks/${talkId}`, {
      params: { with: 'messages' },
      headers,
      validateStatus: () => true,
    });

    // Kommo may embed messages directly on the talk with `with=messages`
    const embeddedMessages = talkData?._embedded?.messages;
    if (Array.isArray(embeddedMessages) && embeddedMessages.length > 0) {
      return NextResponse.json({ messages: embeddedMessages, raw: talkData });
    }

    // Step 2: try via chats endpoint using chat_id from the talk
    const chatId = talkData?.chat_id ?? talkData?._embedded?.chats?.[0]?.id;
    if (chatId) {
      const { data: chatData } = await axios.get(`${base}/chats/${chatId}/messages`, {
        params: { limit: 100 },
        headers,
        validateStatus: () => true,
      });
      const messages = chatData?._embedded?.messages ?? [];
      return NextResponse.json({ messages, raw: chatData });
    }

    // Step 3: fallback — try talks/{id}/messages directly
    const { data: fallbackData } = await axios.get(`${base}/talks/${talkId}/messages`, {
      params: { limit: 100 },
      headers,
      validateStatus: () => true,
    });
    const messages = fallbackData?._embedded?.messages ?? [];
    return NextResponse.json({ messages, raw: fallbackData, talkRaw: talkData });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
