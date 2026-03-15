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

    const dailySales = [...rows].reverse().slice(-14).map(r => ({
      date: String(r.day).substring(0, 10),
      sales: Number(r.sales),
      revenue: Number(r.revenue),
    }));

    // Kommo talks
    const subdomain = process.env.KOMMO_SUBDOMAIN;
    const token = process.env.KOMMO_ACCESS_TOKEN;
    const base = `https://${subdomain}.kommo.com/api/v4`;
    const headers = { Authorization: `Bearer ${token}` };

    let talks: { created_at: number; updated_at: number }[] = [];
    try {
      const { data } = await axios.get(`${base}/talks`, {
        params: { limit: 100, with: 'contact' },
        headers,
        validateStatus: () => true,
      });
      talks = data?._embedded?.talks ?? [];
    } catch {
      // talks stays empty — still return DB metrics
    }

    const nowTs = Date.now() / 1000;
    const dayTs = nowTs - 86400;
    const weekTs = nowTs - 7 * 86400;
    const monthTs = nowTs - 30 * 86400;

    const calcChats = (from: number) => talks.filter(t => t.created_at >= from).length;
    const calcAvgResponse = (from: number) => {
      const filtered = talks.filter(t => t.created_at >= from && t.updated_at > t.created_at);
      if (!filtered.length) return 0;
      const avg = filtered.reduce((s, t) => s + (t.updated_at - t.created_at), 0) / filtered.length;
      return Math.round(avg / 60);
    };

    return NextResponse.json({
      today: { ...aggregate(today), newChats: calcChats(dayTs), avgResponseMinutes: calcAvgResponse(dayTs) },
      week: { ...aggregate(weekAgo), newChats: calcChats(weekTs), avgResponseMinutes: calcAvgResponse(weekTs) },
      month: { ...aggregate(monthAgo), newChats: calcChats(monthTs), avgResponseMinutes: calcAvgResponse(monthTs) },
      dailySales,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
