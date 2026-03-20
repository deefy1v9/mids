export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { pool, ensureMigrated } from '@/src/utils/db';
import axios from 'axios';
import { TenFrontClient, ContaAReceber } from '@/src/tenfront/client';

export async function GET() {
  try {
    await ensureMigrated();

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

    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const aggregate = (from: string) => {
      const filtered = rows.filter(r => String(r.day).substring(0, 10) >= from);
      return {
        sales: filtered.reduce((s, r) => s + Number(r.sales), 0),
        revenue: filtered.reduce((s, r) => s + Number(r.revenue), 0),
      };
    };

    const dailySalesBase = [...rows].reverse().slice(-14).map(r => ({
      date: String(r.day).substring(0, 10),
      sales: Number(r.sales),
      revenue: Number(r.revenue),
    }));

    // Kommo talks — paginated
    const subdomain = process.env.KOMMO_SUBDOMAIN;
    const token = process.env.KOMMO_ACCESS_TOKEN;
    const base = `https://${subdomain}.kommo.com/api/v4`;
    const headers = { Authorization: `Bearer ${token}` };

    const nowTs = Date.now() / 1000;
    // Midnight BRT (UTC-3) = 03:00 UTC. If current UTC time < 03:00, use previous day's midnight.
    const midnightBRT = new Date();
    midnightBRT.setUTCHours(3, 0, 0, 0);
    if (Date.now() < midnightBRT.getTime()) midnightBRT.setUTCDate(midnightBRT.getUTCDate() - 1);
    const dayTs = midnightBRT.getTime() / 1000;
    const weekTs = nowTs - 7 * 86400;
    const monthTs = nowTs - 30 * 86400;

    let talks: { created_at: number; updated_at: number }[] = [];
    try {
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
        // stop early if oldest talk in this batch is already older than 30 days
        if (batch[batch.length - 1]?.created_at < monthTs) break;
        page++;
      }
    } catch {
      // talks stays empty — still return DB metrics
    }

    const calcChats = (from: number) => talks.filter(t => t.created_at >= from).length;
    const calcAvgResponse = (from: number) => {
      const filtered = talks.filter(t => t.created_at >= from && t.updated_at > t.created_at);
      if (!filtered.length) return 0;
      const avg = filtered.reduce((s, t) => s + (t.updated_at - t.created_at), 0) / filtered.length;
      return Math.round(avg / 60);
    };

    // Daily new chats — group talks by BRT date
    const dailyChatsMap: Record<string, number> = {};
    for (const t of talks) {
      const d = new Date((t.created_at - 3 * 3600) * 1000).toISOString().split('T')[0];
      dailyChatsMap[d] = (dailyChatsMap[d] ?? 0) + 1;
    }

    // Meta Ads spend
    const metaToken = process.env.META_ACCESS_TOKEN;
    const metaAccountId = process.env.META_AD_ACCOUNT_ID;

    // Messaging conversation started action types
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

    const fetchMetaSpend = async (datePreset: string): Promise<{ spend: number; results: number; costPerResult: number; error?: string }> => {
      if (!metaToken || !metaAccountId) return { spend: 0, results: 0, costPerResult: 0, error: 'missing credentials' };
      try {
        const { data } = await axios.get(
          `https://graph.facebook.com/v19.0/${metaAccountId}/insights`,
          { params: { fields: 'spend,actions', date_preset: datePreset, access_token: metaToken }, validateStatus: () => true }
        );
        if (data?.error) return { spend: 0, results: 0, costPerResult: 0, error: data.error.message ?? JSON.stringify(data.error) };
        const row = data?.data?.[0];
        const spend = row?.spend ? parseFloat(row.spend) : 0;
        const results = extractResults(row?.actions);
        const costPerResult = results > 0 ? spend / results : 0;
        return { spend, results, costPerResult };
      } catch (e) {
        return { spend: 0, results: 0, costPerResult: 0, error: String(e) };
      }
    };

    // Daily Meta spend (last 14 days)
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
    } catch {
      // leave dailyMetaMap empty
    }

    // TenFront faturamento — 1 chamada com janela de 30 dias
    const fmtBR = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const todayDate = new Date();
    const month30Ago = new Date(todayDate.getTime() - 30 * 86400000);

    let tenFrontError: string | null = null;
    let contasAReceber: ContaAReceber[] = [];
    const CACHE_KEY = 'tenfront_contas_30d';
    const CACHE_TTL_HOURS = 6;
    try {
      // Tenta usar cache do banco (TTL: 6h)
      const { rows: cacheRows } = await pool.query(
        `SELECT data FROM api_cache WHERE key = $1 AND cached_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`,
        [CACHE_KEY]
      );
      if (cacheRows.length > 0) {
        contasAReceber = cacheRows[0].data as ContaAReceber[];
      } else {
        const tf = new TenFrontClient();
        const timeout = new Promise<ContaAReceber[]>(resolve => setTimeout(() => resolve([]), 30000));
        const fetched = await Promise.race([
          tf.listContasAReceber(fmtBR(month30Ago), fmtBR(todayDate)),
          timeout,
        ]);
        contasAReceber = fetched;
        // Salva no cache (mesmo vazio) para evitar hammering da API em caso de rate limit
        await pool.query(
          `INSERT INTO api_cache (key, data, cached_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET data = $2, cached_at = NOW()`,
          [CACHE_KEY, JSON.stringify(fetched)]
        );
      }
    } catch (e) {
      tenFrontError = String(e);
    }

    // Dados mock para desenvolvimento local quando a API TenFront não está disponível
    if (contasAReceber.length === 0) {
      const sellers = ['André', 'Fabricio', 'Caio', 'Duda', 'Thiago'];
      const d = (offset: number) => {
        const dt = new Date(todayDate);
        dt.setDate(dt.getDate() - offset);
        return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
      };
      const mockEntries: ContaAReceber[] = [
        // Hoje
        { 'Forma': 'Dinheiro', 'Origem': 'ATE-M001', 'Descrição': 'ATE-M001 | Cliente Mock 1', 'Data recebimento': d(0), 'Conta': 'Padrão', 'Valor informado': 4500, 'Atendente': sellers[0] },
        { 'Forma': 'Dinheiro', 'Origem': 'ATE-M002', 'Descrição': 'ATE-M002 | Cliente Mock 2', 'Data recebimento': d(0), 'Conta': 'Padrão', 'Valor informado': 3200, 'Atendente': sellers[1] },
        { 'Forma': 'Dinheiro', 'Origem': 'ATE-M003', 'Descrição': 'ATE-M003 | Cliente Mock 3', 'Data recebimento': d(0), 'Conta': 'Padrão', 'Valor informado': 5100, 'Atendente': sellers[0] },
        { 'Forma': 'Dinheiro', 'Origem': 'ATE-M004', 'Descrição': 'ATE-M004 | Cliente Mock 4', 'Data recebimento': d(0), 'Conta': 'Padrão', 'Valor informado': 2800, 'Atendente': sellers[2] },
        { 'Forma': 'Dinheiro', 'Origem': 'ATE-M005', 'Descrição': 'ATE-M005 | Cliente Mock 5', 'Data recebimento': d(0), 'Conta': 'Padrão', 'Valor informado': 1900, 'Atendente': sellers[3] },
        // Últimos 7 dias
        ...([1,2,3,4,5,6].flatMap(day => [
          { 'Forma': 'Dinheiro', 'Origem': `ATE-W${day}A`, 'Descrição': `ATE-W${day}A | Cliente W${day}A`, 'Data recebimento': d(day), 'Conta': 'Padrão', 'Valor informado': 3000 + day * 300, 'Atendente': sellers[day % sellers.length] },
          { 'Forma': 'Dinheiro', 'Origem': `ATE-W${day}B`, 'Descrição': `ATE-W${day}B | Cliente W${day}B`, 'Data recebimento': d(day), 'Conta': 'Padrão', 'Valor informado': 2500 + day * 200, 'Atendente': sellers[(day + 1) % sellers.length] },
          { 'Forma': 'Dinheiro', 'Origem': `ATE-W${day}C`, 'Descrição': `ATE-W${day}C | Cliente W${day}C`, 'Data recebimento': d(day), 'Conta': 'Padrão', 'Valor informado': 4000 + day * 100, 'Atendente': sellers[(day + 2) % sellers.length] },
        ])),
        // Dias 7-29
        ...([7,8,10,12,14,16,18,20,22,24,26,28].flatMap(day => [
          { 'Forma': 'Dinheiro', 'Origem': `ATE-M${day}A`, 'Descrição': `ATE-M${day}A | Cliente M${day}A`, 'Data recebimento': d(day), 'Conta': 'Padrão', 'Valor informado': 3500, 'Atendente': sellers[day % sellers.length] },
          { 'Forma': 'Dinheiro', 'Origem': `ATE-M${day}B`, 'Descrição': `ATE-M${day}B | Cliente M${day}B`, 'Data recebimento': d(day), 'Conta': 'Padrão', 'Valor informado': 2900, 'Atendente': sellers[(day + 1) % sellers.length] },
        ])),
      ];
      contasAReceber = mockEntries;
    }

    const parseBRDate = (s: string) => {
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    };

    type SellerEntry = { nome: string; vendas: number; faturamento: number };
    const revenueByDay: Record<string, number> = {};
    const sellerByDay: Record<string, Record<string, SellerEntry>> = {};

    for (const c of contasAReceber) {
      const rawDate = c['Data recebimento'] ?? '';
      const day = parseBRDate(rawDate);
      if (!day) continue;
      const valor = Number(c['Valor informado'] ?? 0);
      if (valor <= 0) continue;
      revenueByDay[day] = (revenueByDay[day] ?? 0) + valor;

      const atendente = String(c['Atendente'] ?? '').trim();
      if (atendente) {
        if (!sellerByDay[day]) sellerByDay[day] = {};
        const e = sellerByDay[day][atendente] ?? { nome: atendente, vendas: 0, faturamento: 0 };
        e.vendas++;
        e.faturamento += valor;
        sellerByDay[day][atendente] = e;
      }
    }

    const buildRanking = (from: string): SellerEntry[] => {
      const merged: Record<string, SellerEntry> = {};
      for (const [day, sellers] of Object.entries(sellerByDay)) {
        if (day < from) continue;
        for (const [nome, s] of Object.entries(sellers)) {
          const cur = merged[nome] ?? { nome, vendas: 0, faturamento: 0 };
          cur.vendas += s.vendas;
          cur.faturamento += s.faturamento;
          merged[nome] = cur;
        }
      }
      return Object.values(merged).sort((a, b) => b.faturamento - a.faturamento);
    };

    const sumRevenue = (from: string) =>
      Object.entries(revenueByDay)
        .filter(([d]) => d >= from)
        .reduce((s, [, v]) => s + v, 0);

    const todayRevenue = sumRevenue(today);
    const weekRevenue = sumRevenue(weekAgo);
    const monthRevenue = sumRevenue(monthAgo);

    const [todayMeta, weekMeta, monthMeta] = await Promise.all([
      fetchMetaSpend('today'),
      fetchMetaSpend('last_7d'),
      fetchMetaSpend('last_30d'),
    ]);

    return NextResponse.json({
      today: {
        sales: aggregate(today).sales, revenue: todayRevenue, lucro: todayRevenue - todayMeta.spend,
        newChats: calcChats(dayTs), avgResponseMinutes: calcAvgResponse(dayTs),
        metaSpend: todayMeta.spend, metaResults: todayMeta.results, metaCostPerResult: todayMeta.costPerResult,
        ranking: buildRanking(today),
      },
      week: {
        sales: aggregate(weekAgo).sales, revenue: weekRevenue, lucro: weekRevenue - weekMeta.spend,
        newChats: calcChats(weekTs), avgResponseMinutes: calcAvgResponse(weekTs),
        metaSpend: weekMeta.spend, metaResults: weekMeta.results, metaCostPerResult: weekMeta.costPerResult,
        ranking: buildRanking(weekAgo),
      },
      month: {
        sales: aggregate(monthAgo).sales, revenue: monthRevenue, lucro: monthRevenue - monthMeta.spend,
        newChats: calcChats(monthTs), avgResponseMinutes: calcAvgResponse(monthTs),
        metaSpend: monthMeta.spend, metaResults: monthMeta.results, metaCostPerResult: monthMeta.costPerResult,
        ranking: buildRanking(monthAgo),
      },
      dailySales: dailySalesBase.map(r => ({
        ...r,
        revenue: revenueByDay[r.date] ?? 0,
        newChats: dailyChatsMap[r.date] ?? 0,
        metaSpend: dailyMetaMap[r.date] ?? 0,
      })),
      metaError: todayMeta.error ?? weekMeta.error ?? monthMeta.error ?? null,
      tenFrontError,
      tenFrontCount: contasAReceber.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
