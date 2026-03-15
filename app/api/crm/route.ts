export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET() {
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const token = process.env.KOMMO_ACCESS_TOKEN;
  const base = `https://${subdomain}.kommo.com/api/v4`;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    // Busca pipelines com etapas
    const { data: pipelinesData } = await axios.get(`${base}/leads/pipelines`, {
      params: { with: 'statuses', limit: 50 },
      headers,
    });

    const pipelines = pipelinesData?._embedded?.pipelines ?? [];

    // Busca leads abertos com contatos vinculados
    const { data: leadsData } = await axios.get(`${base}/leads`, {
      params: { with: 'contacts', limit: 250, filter: { statuses: [{ status_id: 0 }] } },
      headers,
    });

    const leads = leadsData?._embedded?.leads ?? [];

    return NextResponse.json({ pipelines, leads });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: unknown; status?: number } }).response
        : undefined;
    return NextResponse.json({ error: message, detail }, { status: 500 });
  }
}
