import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET() {
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const token = process.env.KOMMO_ACCESS_TOKEN;
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const { data } = await axios.get(`${base}/talks`, {
      params: { limit: 50, with: 'contact' },
      headers,
      validateStatus: () => true,
    });

    const talks = data?._embedded?.talks ?? [];
    return NextResponse.json({ talks, raw: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
