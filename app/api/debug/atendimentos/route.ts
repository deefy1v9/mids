import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dataInicial = searchParams.get('data-inicial') ?? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const dataFinal = searchParams.get('data-final') ?? new Date().toISOString().split('T')[0];

  const baseURL = process.env.TENFRONT_BASE_URL ?? 'https://api.tenfront.com.br/v1';
  const token = process.env.TENFRONT_BEARER_TOKEN;
  const consumerKey = process.env.TENFRONT_CONSUMER_KEY;
  const consumerSecret = process.env.TENFRONT_CONSUMER_SECRET;

  try {
    const { data } = await axios.post(
      `${baseURL}/listar-atendimentos`,
      { page: 1, 'data-inicial': dataInicial, 'data-final': dataFinal },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Consumer-key': consumerKey,
          'Consumer-secret': consumerSecret,
        },
      }
    );
    return NextResponse.json({ raw: data, dataInicial, dataFinal });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: unknown; status?: number } }).response
        : undefined;
    return NextResponse.json({ error: message, detail }, { status: 500 });
  }
}
