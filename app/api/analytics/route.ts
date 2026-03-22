export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { pool, ensureMigrated } from '@/src/utils/db';
import axios from 'axios';
import { TenFrontClient, ContaAReceber } from '@/src/tenfront/client';

export async function GET(req: NextRequest) {
  try {
    await ensureMigrated();

    const rawPeriod = req.nextUrl.searchParams.get('period') ?? 'today';
    const period = (['today', 'week', 'month'] as const).includes(rawPeriod as 'today' | 'week' | 'month')
      ? (rawPeriod as 'today' | 'week' | 'month')
      : 'today';

    const todayDate = new Date();
    const fmtBR = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    const weekAgoDate = new Date(todayDate.getTime() - 7 * 86400000);
    const monthAgoDate = new Date(todayDate.getTime() - 30 * 86400000);

    const nowTs = Date.now() / 1000;
    const midnightBRT = new Date();
    midnightBRT.setUTCHours(3, 0, 0, 0);
    if (Date.now() < midnightBRT.getTime()) midnightBRT.setUTCDate(midnightBRT.getUTCDate() - 1);
    const dayTs = midnightBRT.getTime() / 1000;
    const weekTs = nowTs - 7 * 86400;
    const monthTs = nowTs - 30 * 86400;

    const todayStr   = todayDate.toISOString().split('T')[0];
    const PERIOD_CONFIG = {
      today: { fromDate: todayDate, metaPreset: 'today',    fromTs: dayTs,   cacheKey: `tenfront_contas_today_${todayStr}`, cacheTTL: 1 },
      week:  { fromDate: weekAgoDate,  metaPreset: 'last_7d',  fromTs: weekTs,  cacheKey: 'tenfront_contas_week',  cacheTTL: 3 },
      month: { fromDate: monthAgoDate, metaPreset: 'last_30d', fromTs: monthTs, cacheKey: 'tenfront_contas_month', cacheTTL: 6 },
    };
    const cfg = PERIOD_CONFIG[period];

    const fromStr    = cfg.fromDate.toISOString().split('T')[0];
    const chart14Str = new Date(todayDate.getTime() - 14 * 86400000).toISOString().split('T')[0];

    // ── Matches DB ──────────────────────────────────────────────────────────────
    const { rows } = await pool.query(`
      SELECT
        DATE(date AT TIME ZONE 'America/Sao_Paulo') as day,
        COUNT(*) FILTER (WHERE action = 'won') as sales,
        COALESCE(SUM(valor) FILTER (WHERE action = 'won'), 0) as revenue
      FROM matches
      WHERE date >= NOW() - INTERVAL '30 days'
      GROUP BY day
      ORDER BY day DESC
    `);

    const dbFrom = period === 'today' ? todayStr : fromStr;
    const dbFiltered = rows.filter(r => String(r.day).substring(0, 10) >= dbFrom);
    const sales   = dbFiltered.reduce((s, r) => s + Number(r.sales), 0);
    const dbRevenue = dbFiltered.reduce((s, r) => s + Number(r.revenue), 0);

    const chart14Rows = [...rows].filter(r => String(r.day).substring(0, 10) >= chart14Str).reverse();

    // ── Kommo chats (cache 15min) ────────────────────────────────────────────────
    const subdomain = process.env.KOMMO_SUBDOMAIN;
    const token     = process.env.KOMMO_ACCESS_TOKEN;
    const base      = `https://${subdomain}.kommo.com/api/v4`;
    const headers   = { Authorization: `Bearer ${token}` };

    let talks: { created_at: number; updated_at: number }[] = [];
    try {
      const { rows: talkCache } = await pool.query(
        `SELECT data FROM api_cache WHERE key = 'kommo_talks' AND cached_at > NOW() - INTERVAL '15 minutes'`
      );
      if (talkCache.length > 0) {
        talks = talkCache[0].data as typeof talks;
      } else {
        let page = 1;
        const talkLimit = 250;
        while (true) {
          const { data } = await axios.get(`${base}/talks`, {
            params: { limit: talkLimit, page, with: 'contact' },
            headers,
            validateStatus: () => true,
          });
          const batch: { created_at: number; updated_at: number }[] = data?._embedded?.talks ?? [];
          talks = talks.concat(batch);
          if (batch.length < talkLimit) break;
          if (batch[batch.length - 1]?.created_at < monthTs) break;
          page++;
        }
        await pool.query(
          `INSERT INTO api_cache (key, data, cached_at) VALUES ('kommo_talks', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET data = $1, cached_at = NOW()`,
          [JSON.stringify(talks)]
        );
      }
    } catch { /* talks stays empty */ }

    const calcChats       = (from: number) => talks.filter(t => t.created_at >= from).length;
    const calcAvgResponse = (from: number) => {
      const filtered = talks.filter(t => t.created_at >= from && t.updated_at > t.created_at);
      if (!filtered.length) return 0;
      return Math.round(filtered.reduce((s, t) => s + (t.updated_at - t.created_at), 0) / filtered.length / 60);
    };

    const dailyChatsMap: Record<string, number> = {};
    for (const t of talks) {
      const d = new Date((t.created_at - 3 * 3600) * 1000).toISOString().split('T')[0];
      dailyChatsMap[d] = (dailyChatsMap[d] ?? 0) + 1;
    }

    // ── Meta Ads ─────────────────────────────────────────────────────────────────
    const metaToken     = process.env.META_ACCESS_TOKEN;
    const metaAccountId = process.env.META_AD_ACCOUNT_ID;

    const RESULT_ACTIONS = [
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.total_messaging_connection',
      'messaging_first_replies',
    ];
    const extractResults = (actions?: { action_type: string; value: string }[]): number => {
      if (!actions) return 0;
      for (const key of RESULT_ACTIONS) {
        const match = actions.find(a => a.action_type === key);
        if (match) return parseInt(match.value, 10);
      }
      return 0;
    };

    const fetchMetaSpend = async (datePreset: string) => {
      if (!metaToken || !metaAccountId) return { spend: 0, results: 0, costPerResult: 0, error: 'missing credentials' };
      try {
        const { data } = await axios.get(
          `https://graph.facebook.com/v19.0/${metaAccountId}/insights`,
          { params: { fields: 'spend,actions', date_preset: datePreset, access_token: metaToken }, validateStatus: () => true }
        );
        if (data?.error) return { spend: 0, results: 0, costPerResult: 0, error: data.error.message ?? JSON.stringify(data.error) };
        const row    = data?.data?.[0];
        const spend  = row?.spend ? parseFloat(row.spend) : 0;
        const results = extractResults(row?.actions);
        return { spend, results, costPerResult: results > 0 ? spend / results : 0, error: undefined };
      } catch (e) {
        return { spend: 0, results: 0, costPerResult: 0, error: String(e) };
      }
    };

    // Daily meta spend — sempre últimos 14 dias para o gráfico
    let dailyMetaMap: Record<string, number> = {};
    try {
      if (metaToken && metaAccountId) {
        const { data: metaDaily } = await axios.get(
          `https://graph.facebook.com/v19.0/${metaAccountId}/insights`,
          { params: { fields: 'spend', date_preset: 'last_14d', time_increment: 1, access_token: metaToken }, validateStatus: () => true }
        );
        if (Array.isArray(metaDaily?.data)) {
          for (const entry of metaDaily.data as { spend?: string; date_start?: string }[]) {
            if (entry.date_start) dailyMetaMap[entry.date_start] = parseFloat(entry.spend ?? '0');
          }
        }
      }
    } catch { /* leave empty */ }

    const metaData = await fetchMetaSpend(cfg.metaPreset);

    // ── TenFront contas a receber ────────────────────────────────────────────────
    let tenFrontError: string | null = null;
    let contasAReceber: ContaAReceber[] = [];
    try {
      const { rows: cacheRows } = await pool.query(
        `SELECT data FROM api_cache WHERE key = $1 AND cached_at > NOW() - INTERVAL '${cfg.cacheTTL} hours'`,
        [cfg.cacheKey]
      );
      if (cacheRows.length > 0) {
        contasAReceber = cacheRows[0].data as ContaAReceber[];
      } else {
        const tf = new TenFrontClient();
        const timeout = new Promise<ContaAReceber[]>(resolve => setTimeout(() => resolve([]), 30000));
        const fetched = await Promise.race([
          tf.listContasAReceber(fmtBR(cfg.fromDate), fmtBR(todayDate)),
          timeout,
        ]);
        contasAReceber = fetched;
        await pool.query(
          `INSERT INTO api_cache (key, data, cached_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET data = $2, cached_at = NOW()`,
          [cfg.cacheKey, JSON.stringify(fetched)]
        );
      }
    } catch (e) {
      tenFrontError = String(e);
    }

    // ── Processar contas a receber ───────────────────────────────────────────────
    const parseBRDate = (s: string) => {
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    };

    type SellerEntry = { nome: string; vendas: number; faturamento: number };
    const revenueByDay: Record<string, number> = {};
    const sellerAgg: Record<string, SellerEntry> = {};

    for (const c of contasAReceber) {
      const day = parseBRDate(c['Data recebimento'] ?? '');
      if (!day) continue;
      const valor = Number(c['Valor informado'] ?? 0);
      if (valor <= 0) continue;
      revenueByDay[day] = (revenueByDay[day] ?? 0) + valor;

      // Ranking e revenue filtrado pelo período
      if (day < fromStr) continue;

      const atendente = String(c['Atendente'] ?? '').trim();
      if (atendente) {
        const e = sellerAgg[atendente] ?? { nome: atendente, vendas: 0, faturamento: 0 };
        e.vendas++;
        e.faturamento += valor;
        sellerAgg[atendente] = e;
      }
    }

    const revenue = Object.entries(revenueByDay)
      .filter(([d]) => d >= fromStr)
      .reduce((s, [, v]) => s + v, 0);

    const ranking = Object.values(sellerAgg).sort((a, b) => b.faturamento - a.faturamento);

    const metaSpend = metaData.spend;

    // ── Montar dailySales (últimos 14 dias, para o gráfico) ─────────────────────
    const dailySales = chart14Rows.map(r => ({
      date:     String(r.day).substring(0, 10),
      sales:    Number(r.sales),
      revenue:  revenueByDay[String(r.day).substring(0, 10)] ?? 0,
      newChats: dailyChatsMap[String(r.day).substring(0, 10)] ?? 0,
      metaSpend: dailyMetaMap[String(r.day).substring(0, 10)] ?? 0,
    }));

    return NextResponse.json({
      period,
      sales,
      revenue,
      lucro: revenue - metaSpend,
      newChats:           calcChats(cfg.fromTs),
      avgResponseMinutes: calcAvgResponse(cfg.fromTs),
      metaSpend,
      metaResults:        metaData.results,
      metaCostPerResult:  metaData.costPerResult,
      ranking,
      dailySales,
      metaError:    metaData.error ?? null,
      tenFrontError,
      tenFrontCount: contasAReceber.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
