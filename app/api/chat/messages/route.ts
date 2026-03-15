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
    const { data } = await axios.get(`${base}/talks/${talkId}/messages`, {
      params: { limit: 50 },
      headers,
      validateStatus: () => true,
    });
    const messages = data?._embedded?.messages ?? [];
    return NextResponse.json({ messages });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
