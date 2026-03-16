export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(req: NextRequest) {
  const baseURL = process.env.TENFRONT_BASE_URL ?? 'https://api.tenfront.com.br/v1';
  const token = process.env.TENFRONT_BEARER_TOKEN;
  const consumerKey = process.env.TENFRONT_CONSUMER_KEY;
  const consumerSecret = process.env.TENFRONT_CONSUMER_SECRET;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'Consumer-key': consumerKey!,
    'Consumer-secret': consumerSecret!,
  };

  // Query params: ?page=1&dataInicial=2026-03-16&dataFinal=2026-03-16&allPages=true
  const pageParam = req.nextUrl.searchParams.get('page');
  const dataInicial = req.nextUrl.searchParams.get('dataInicial');
  const dataFinal = req.nextUrl.searchParams.get('dataFinal');
  const allPages = req.nextUrl.searchParams.get('allPages') === 'true';

  try {
    if (allPages) {
      // Paginate all pages and return summary
      const all: unknown[] = [];
      let page = 1;
      let totalPages = 1;
      const pageRaws: unknown[] = [];

      do {
        const body: Record<string, unknown> = { page };
        if (dataInicial) body['data-inicial'] = dataInicial;
        if (dataFinal) body['data-final'] = dataFinal;

        const { data } = await axios.post(`${baseURL}/listar-clientes`, body, { headers });

        pageRaws.push({ page, meta: { totalPages: data['Total pages'] ?? data['total_pages'], keys: Object.keys(data) } });
        totalPages = Number(data['Total pages'] ?? data['total_pages'] ?? 1);

        const raw = data['Response'] ?? data['response'];
        const items = Array.isArray(raw) ? raw : [];
        all.push(...items);
        page++;
      } while (page <= totalPages);

      // Show field names from first item + last item + total count
      const firstItem = all[0] ?? null;
      const lastItem = all[all.length - 1] ?? null;
      return NextResponse.json({
        totalItems: all.length,
        totalPages,
        filterApplied: { dataInicial, dataFinal },
        fieldNames: firstItem ? Object.keys(firstItem as object) : [],
        firstItem,
        lastItem,
        pageRaws,
        // Show first 3 and last 3 items to understand date field
        sampleItems: [...all.slice(0, 3), ...all.slice(-3)],
      });
    }

    // Single page fetch
    const page = pageParam ? parseInt(pageParam) : 1;
    const body: Record<string, unknown> = { page };
    if (dataInicial) body['data-inicial'] = dataInicial;
    if (dataFinal) body['data-final'] = dataFinal;

    const { data } = await axios.post(`${baseURL}/listar-clientes`, body, { headers });

    const raw = data['Response'] ?? data['response'];
    const items = Array.isArray(raw) ? raw : [];

    return NextResponse.json({
      page,
      totalPages: data['Total pages'] ?? data['total_pages'],
      totalItems: items.length,
      filterApplied: { dataInicial, dataFinal },
      fieldNames: items[0] ? Object.keys(items[0] as object) : [],
      firstItem: items[0] ?? null,
      lastItem: items[items.length - 1] ?? null,
      rawMeta: { ...data, Response: undefined, response: undefined },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: unknown; status?: number } }).response
        : undefined;
    return NextResponse.json({ error: message, detail }, { status: 500 });
  }
}
