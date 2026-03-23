export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { pool, ensureMigrated } from '@/src/utils/db';
import { readSheetData, isConnected } from '@/src/google/sheets';

interface SellerAgg  { nome: string; vendas: number; faturamento: number; }
interface ProductAgg { nome: string; vendas: number; faturamento: number; }
interface DateAgg    { date: string; faturamento: number; vendas: number; }

const CACHE_KEY = 'google_sheets_data';
const CACHE_TTL = 30; // minutos

export async function GET(req: NextRequest) {
  try {
    await ensureMigrated();

    // Força re-fetch se ?refresh=1
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';

    if (!forceRefresh) {
      const { rows: cacheRows } = await pool.query(
        `SELECT data FROM api_cache WHERE key = $1 AND cached_at > NOW() - INTERVAL '${CACHE_TTL} minutes'`,
        [CACHE_KEY]
      );
      if (cacheRows[0]) return NextResponse.json(cacheRows[0].data);
    }

    const connected = await isConnected();
    if (!connected) return NextResponse.json({ connected: false });

    const raw = await readSheetData();

    // Agregar por vendedor
    const sellerMap: Record<string, SellerAgg> = {};
    for (const r of raw) {
      const key = r.seller || 'Desconhecido';
      const e = sellerMap[key] ?? { nome: key, vendas: 0, faturamento: 0 };
      e.vendas++;
      e.faturamento += r.value;
      sellerMap[key] = e;
    }
    const bySeller = Object.values(sellerMap).sort((a, b) => b.faturamento - a.faturamento);

    // Agregar por produto
    const productMap: Record<string, ProductAgg> = {};
    for (const r of raw) {
      const key = r.product || 'Outros';
      const e = productMap[key] ?? { nome: key, vendas: 0, faturamento: 0 };
      e.vendas++;
      e.faturamento += r.value;
      productMap[key] = e;
    }
    const byProduct = Object.values(productMap).sort((a, b) => b.faturamento - a.faturamento);

    // Agregar por data (normalizar para YYYY-MM-DD)
    const dateMap: Record<string, DateAgg> = {};
    for (const r of raw) {
      const normalized = normalizeDate(r.date);
      if (!normalized) continue;
      const e = dateMap[normalized] ?? { date: normalized, faturamento: 0, vendas: 0 };
      e.faturamento += r.value;
      e.vendas++;
      dateMap[normalized] = e;
    }
    const byDate = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

    const totalRevenue = raw.reduce((s, r) => s + r.value, 0);
    const totalSales   = raw.length;
    const ticketMedio  = totalSales > 0 ? totalRevenue / totalSales : 0;

    const result = { connected: true, totalRevenue, totalSales, ticketMedio, bySeller, byProduct, byDate };

    await pool.query(
      `INSERT INTO api_cache (key, data, cached_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $2, cached_at = NOW()`,
      [CACHE_KEY, JSON.stringify(result)]
    );

    return NextResponse.json(result);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not_connected')) return NextResponse.json({ connected: false });
    return NextResponse.json({ error: msg, connected: false }, { status: 500 });
  }
}

/** Aceita DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY */
function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY ou DD-MM-YYYY
  const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  return null;
}
