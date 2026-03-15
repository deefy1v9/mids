export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { pool, ensureMigrated } from '@/src/utils/db';
import axios from 'axios';

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

    const fetchMetaSpend = async (datePreset: string): Promise<{ spend: number; error?: string }> => {
      if (!metaToken || !metaAccountId) return { spend: 0, error: 'missing credentials' };
      try {
        const { data } = await axios.get(
          `https://graph.facebook.com/v19.0/${metaAccountId}/insights`,
          { params: { fields: 'spend', date_preset: datePreset, access_token: metaToken }, validateStatus: () => true }
        );
        if (data?.error) return { spend: 0, error: data.error.message ?? JSON.stringify(data.error) };
        const spend = data?.data?.[0]?.spend;
        return { spend: spend ? parseFloat(spend) : 0 };
      } catch (e) {
        return { spend: 0, error: String(e) };
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

    const dailySales = dailySalesBase.map(r => ({
      ...r,
      newChats: dailyChatsMap[r.date] ?? 0,
      metaSpend: dailyMetaMap[r.date] ?? 0,
    }));

    const [todayMeta, weekMeta, monthMeta] = await Promise.all([
      fetchMetaSpend('today'),
      fetchMetaSpend('last_7d'),
      fetchMetaSpend('last_30d'),
    ]);

    return NextResponse.json({
      today: { ...aggregate(today), newChats: calcChats(dayTs), avgResponseMinutes: calcAvgResponse(dayTs), metaSpend: todayMeta.spend },
      week: { ...aggregate(weekAgo), newChats: calcChats(weekTs), avgResponseMinutes: calcAvgResponse(weekTs), metaSpend: weekMeta.spend },
      month: { ...aggregate(monthAgo), newChats: calcChats(monthTs), avgResponseMinutes: calcAvgResponse(monthTs), metaSpend: monthMeta.spend },
      dailySales,
      metaError: todayMeta.error ?? weekMeta.error ?? monthMeta.error ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
