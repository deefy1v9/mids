export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET() {
  const baseURL = process.env.TENFRONT_BASE_URL ?? 'https://api.tenfront.com.br/v1';
  const token = process.env.TENFRONT_BEARER_TOKEN;
  const consumerKey = process.env.TENFRONT_CONSUMER_KEY;
  const consumerSecret = process.env.TENFRONT_CONSUMER_SECRET;

  try {
    const { data } = await axios.post(
      `${baseURL}/listar-clientes`,
      { page: 1 },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Consumer-key': consumerKey,
          'Consumer-secret': consumerSecret,
        },
      }
    );
    return NextResponse.json({ raw: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: unknown; status?: number } }).response
        : undefined;
    return NextResponse.json({ error: message, detail }, { status: 500 });
  }
}
